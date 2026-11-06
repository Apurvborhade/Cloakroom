/**
 * Runs long, short, close and liquidation through the real API, executor and signer, against
 * Uniswap's real contracts on a local fork of Sepolia. Nothing reaches the real chain.
 *
 * Accounting is the stand-in, and the liquidations' price moves are simulated. See
 * docs/margin-interface.md.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDomain,
  deriveEnclaveSalt,
  EIP712_TYPES,
  NATIVE,
  sealEnvelopeWithResponse,
} from '@cloakroom/shared';
import type { PriceReport } from '@cloakroom/shared';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseAbiParameters,
  parseEther,
} from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { loadConfig } from '../src/config.js';
import { KeyManager } from '../src/keys.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { bootEnclave } from '../src/server.js';
import { UniswapClient } from '../src/uniswap.js';
import type { Quote, QuoteRequest } from '../src/uniswap.js';

const FORK_PORT = 18_997;
const API_PORT = 18_998;
/** Approved Permit2 and the router on real Sepolia, so the API returns USDC to ETH swaps for it. */
const APPROVED_ADDRESS: Address = '0xb544e415F5109a37c9c364062168b2564CEA9481';
const USDC_DECIMALS = 6;
const COLLATERAL = 25_000_000n;
const LEVERAGE_BPS = 40_000;
const SLIPPAGE_BPS = 100;
const PRICE_SCALE = 10n ** 18n;
const ROUTER_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const COMMAND_UNWRAP = '0c';
const COMMAND_SWEEP = '04';

let failures = 0;
function check(name: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}
const usd = (value: string | bigint) => formatUnits(BigInt(value), USDC_DECIMALS);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The API reads real Sepolia, where a custody address on this fork has no approvals. So USDC to
 * ETH asks for an approved address's route, and points its payouts at the custody address.
 */
function forkQuoter(live: UniswapClient) {
  return {
    quote: async (request: QuoteRequest): Promise<Quote> => {
      if (getAddress(request.tokenOut) !== getAddress(NATIVE) || !request.protocols) return live.quote(request);
      const quote = await live.quote({ ...request, swapper: APPROVED_ADDRESS });
      if (!quote.transaction) return quote;
      const [commands, inputs, deadline] = decodeFunctionData({ abi: ROUTER_ABI, data: quote.transaction.data }).args;
      const steps = commands.slice(2).match(/../g) ?? [];
      const rewritten = inputs.map((input, index) => {
        if (steps[index] === COMMAND_UNWRAP) {
          const [, minimum] = decodeAbiParameters(parseAbiParameters('address, uint256'), input);
          return encodeAbiParameters(parseAbiParameters('address, uint256'), [request.swapper, minimum]);
        }
        if (steps[index] === COMMAND_SWEEP) {
          const [token, , minimum] = decodeAbiParameters(parseAbiParameters('address, address, uint256'), input);
          return encodeAbiParameters(parseAbiParameters('address, address, uint256'), [token, request.swapper, minimum]);
        }
        return input;
      });
      return {
        ...quote,
        transaction: {
          ...quote.transaction,
          from: request.swapper,
          data: encodeFunctionData({ abi: ROUTER_ABI, functionName: 'execute', args: [commands, rewritten, deadline] }),
        },
      };
    },
  };
}

function apiClient(baseUrl: string, chainId: number, enclavePubKey: Hex) {
  const domain = createDomain(chainId, deriveEnclaveSalt(enclavePubKey));
  let nonce = BigInt(Math.floor(Date.now() / 1000));
  const expiry = () => Math.floor(Date.now() / 1000) + 120;

  const post = async (path: string, payload: unknown) => {
    const { envelope, openResponse } = await sealEnvelopeWithResponse(payload, { path, chainId, enclavePubKey });
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${path} refused: ${(body as { error: string }).error}`);
    return (await openResponse(body)) as Record<string, unknown>;
  };

  const signed = async (
    owner: PrivateKeyAccount,
    primaryType: keyof typeof EIP712_TYPES,
    path: string,
    wire: Record<string, unknown>,
    typed: Record<string, unknown>,
  ) => {
    nonce += 1n;
    const expires = expiry();
    const signature = await owner.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType,
      message: { owner: owner.address, ...typed, nonce, expiry: BigInt(expires) },
    } as never);
    return post(path, {
      message: { owner: owner.address, ...wire, nonce: String(nonce), expiry: String(expires) },
      signature,
    });
  };

  return {
    supply: (owner: PrivateKeyAccount, token: Address, amount: bigint) =>
      signed(owner, 'MarginSupply', '/margin/lending/supply', { token, amount: String(amount) }, { token, amount }),
    open: async (owner: PrivateKeyAccount, side: 'long' | 'short', limitPrice: bigint) => {
      const fields = { collateral: COLLATERAL, leverageBps: LEVERAGE_BPS, limitPrice, maxSlippageBps: SLIPPAGE_BPS };
      const { positionId } = await signed(owner, 'MarginOpen', '/margin/positions/open', {
        side,
        collateral: String(COLLATERAL),
        leverageBps: LEVERAGE_BPS,
        limitPrice: String(limitPrice),
        maxSlippageBps: SLIPPAGE_BPS,
      }, { side: side === 'long' ? 0 : 1, ...fields });
      return positionId as Hex;
    },
    addCollateral: (owner: PrivateKeyAccount, positionId: Hex, amount: bigint) =>
      signed(owner, 'MarginAddCollateral', '/margin/positions/collateral', { positionId, amount: String(amount) }, { positionId, amount }),
    close: (owner: PrivateKeyAccount, positionId: Hex, limitPrice: bigint) =>
      signed(owner, 'MarginClose', '/margin/positions/close', {
        positionId,
        limitPrice: String(limitPrice),
        maxSlippageBps: SLIPPAGE_BPS,
      }, { positionId, limitPrice, maxSlippageBps: SLIPPAGE_BPS }),
    positions: async (owner: PrivateKeyAccount, session: PrivateKeyAccount) => {
      const expires = expiry();
      await post('/session', {
        message: { owner: owner.address, sessionKey: session.address, expiry: String(expires) },
        signature: await owner.signTypedData({
          domain,
          types: EIP712_TYPES,
          primaryType: 'SessionGrant',
          message: { owner: owner.address, sessionKey: session.address, expiry: BigInt(expires) },
        }),
      });
      const { positions } = await post('/margin/positions', {
        message: { owner: owner.address, expiry: String(expires) },
        signature: await session.signTypedData({
          domain,
          types: EIP712_TYPES,
          primaryType: 'SessionQuery',
          message: { owner: owner.address, expiry: BigInt(expires) },
        }),
      });
      return positions as Array<Record<string, string>>;
    },
  };
}

async function main(): Promise<void> {
  const rpcUrl = required('RPC_URL');
  const apiKey = required('UNISWAP_API_KEY');
  const apiUrl = required('UNISWAP_API_URL');
  const usdc = getAddress(required('TOKEN_OUT_ADDRESS'));
  if (Number(required('CHAIN_ID')) !== sepolia.id) throw new Error('CHAIN_ID must be Sepolia');

  const forkUrl = `http://127.0.0.1:${FORK_PORT}`;
  const anvil = spawn('anvil', ['--fork-url', rpcUrl, '--port', String(FORK_PORT), '--silent'], { stdio: 'ignore' });
  const directory = mkdtempSync(join(tmpdir(), 'cloakroom-margin-'));
  let stop: (() => Promise<void>) | undefined;

  try {
    const transport = http(forkUrl);
    const chain = createPublicClient({ chain: sepolia, transport, cacheTime: 0, pollingInterval: 200 }) as PublicClient;
    const test = createTestClient({ chain: sepolia, mode: 'anvil', transport });
    const wallet = createWalletClient({ chain: sepolia, transport });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await chain.getBlockNumber();
        break;
      } catch {
        if (attempt >= 60) throw new Error('The fork did not start');
        await delay(500);
      }
    }

    const live = new UniswapClient({ apiUrl, apiKey, chainId: sepolia.id, timeoutMs: 15_000 });
    const reference = await live.quote({
      tokenIn: NATIVE,
      tokenOut: usdc,
      amountIn: parseEther('0.01'),
      swapper: privateKeyToAccount(generatePrivateKey()).address,
    });
    const market = (reference.amountOut * 100n * PRICE_SCALE) / 10n ** BigInt(USDC_DECIMALS);
    console.log(`Sepolia price: ${formatUnits(market, 18)} USDC per ETH\n`);

    let simulated = market;
    const prices = {
      latest: (): PriceReport => ({
        pair: 'ETH/USDC',
        price: simulated,
        ts: Math.floor(Date.now() / 1000),
        source: 'simulated',
      }),
    };

    const running = await bootEnclave({
      config: loadConfig({
        ...process.env,
        RPC_URL: forkUrl,
        CONFIRMATIONS: '0',
        SIM_MODE: 'true',
        MARGIN_ENABLED: 'true',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        JOURNAL_PATH: join(directory, 'enclave.journal'),
        INVENTORY_EOA_COUNT: '2',
        CUSTODY_ALLOW_CREATE: 'true',
        PRICE_POLL_INTERVAL_SEC: '4',
      }),
      chain,
      quoter: forkQuoter(live),
      riskPrices: prices,
      openKeys: async (journal, policy) => {
        const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey('aa'.repeat(32), true), true);
        const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate: true });
        await keys.init();
        return keys;
      },
    });
    stop = running.stop;
    const { journal, keys, margin } = running.parts;

    console.log('Funding the pool on the fork');
    const funder = APPROVED_ADDRESS;
    await test.impersonateAccount({ address: funder });
    await test.setBalance({ address: funder, value: parseEther('10') });
    const buy = await live.quote({
      tokenIn: NATIVE,
      tokenOut: usdc,
      amountIn: parseEther('0.05'),
      swapper: funder,
      slippagePercent: 1,
      protocols: ['V2', 'V3'],
    });
    await chain.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({
        account: funder,
        chain: sepolia,
        to: buy.transaction!.to,
        data: buy.transaction!.data,
        value: buy.transaction!.value,
      }),
    });
    const bought = await chain.readContract({ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [funder] });
    const eoas = keys.list().filter((eoa) => eoa.role === 'inventory').map((eoa) => eoa.address);
    for (const eoa of eoas) {
      await test.setBalance({ address: eoa, value: parseEther('1') });
      await chain.waitForTransactionReceipt({
        hash: await wallet.writeContract({
          account: funder,
          chain: sepolia,
          address: usdc,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [eoa, bought / BigInt(eoas.length)],
        }),
      });
    }
    await running.parts.inventory.refresh();
    check('Each address holds USDC and ETH', bought > 0n, `${usd(bought / BigInt(eoas.length))} USDC each`);

    const api = apiClient(`http://127.0.0.1:${API_PORT}`, sepolia.id, keys.transportPublicKey());
    const lender = privateKeyToAccount(generatePrivateKey());
    const trader = privateKeyToAccount(generatePrivateKey());
    const session = privateKeyToAccount(generatePrivateKey());
    await api.supply(lender, usdc, 1_000_000_000n);
    await api.supply(lender, NATIVE, parseEther('1'));
    check('Lender supplied USDC and ETH', true);

    const waitForStatus = async (positionId: Hex, statuses: string[]) => {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const position = (await api.positions(trader, session)).find(({ id }) => id === positionId);
        if (position && statuses.includes(position.status!)) return position;
        await delay(200);
      }
      throw new Error(`Position did not reach ${statuses.join(' or ')}`);
    };
    const room = (percent: bigint) => (market * percent) / 100n;

    console.log('\nLong: 25 USDC at 4x, then closed by the trader');
    const longId = await api.open(trader, 'long', room(110n));
    const long = await waitForStatus(longId, ['open', 'failed']);
    check('Long opened', long.status === 'open', `${formatEther(BigInt(long.asset!))} ETH bought, ${usd(long.debt!)} USDC borrowed`);
    await api.addCollateral(trader, longId, 5_000_000n);
    const topped = (await api.positions(trader, session)).find(({ id }) => id === longId)!;
    check('Collateral added', topped.collateral === '30000000', `${usd(topped.collateral!)} USDC`);
    await api.close(trader, longId, room(90n));
    const closed = await waitForStatus(longId, ['closed', 'open']);
    check('Long closed, loan repaid', closed.status === 'closed' && BigInt(closed.payout!) > 5_000_000n, `paid out ${usd(closed.payout!)} USDC`);

    console.log('\nShort: 25 USDC at 4x, then closed by the trader');
    const shortId = await api.open(trader, 'short', room(90n));
    const short = await waitForStatus(shortId, ['open', 'failed']);
    check('Short opened', short.status === 'open', `${formatEther(BigInt(short.debt!))} ETH borrowed and sold for ${usd(short.asset!)} USDC`);
    await api.close(trader, shortId, room(110n));
    const covered = await waitForStatus(shortId, ['closed', 'open']);
    check('Short closed, ETH bought back', covered.status === 'closed', `paid out ${usd(covered.payout!)} USDC, shortfall ${covered.shortfall} wei`);

    console.log('\nLiquidations: the price check notices a simulated move and closes the position');
    const atRiskLong = await api.open(trader, 'long', room(110n));
    await waitForStatus(atRiskLong, ['open']);
    simulated = room(80n);
    const liquidatedLong = await waitForStatus(atRiskLong, ['liquidated']);
    check('Long liquidated after a simulated 20% drop', liquidatedLong.status === 'liquidated', `shortfall ${usd(liquidatedLong.shortfall!)} USDC`);

    simulated = market;
    const atRiskShort = await api.open(trader, 'short', room(90n));
    await waitForStatus(atRiskShort, ['open']);
    simulated = room(120n);
    const liquidatedShort = await waitForStatus(atRiskShort, ['liquidated']);
    check('Short liquidated after a simulated 20% rise', liquidatedShort.status === 'liquidated', `shortfall ${liquidatedShort.shortfall} wei`);

    while ((margin?.orders.inFlightCount ?? 0) > 0) await delay(100);

    const swaps: Record<string, number> = {};
    for await (const { event } of journal.replay()) {
      if (event.t.startsWith('MARGIN_OP_') || event.t === 'SIGNING_REGISTERED') swaps[event.t] = (swaps[event.t] ?? 0) + 1;
    }
    console.log('\nJournal:', swaps);
    check('Every approved operation settled', swaps.MARGIN_OP_APPROVED === swaps.MARGIN_OP_SETTLED && !swaps.MARGIN_OP_FAILED);
  } finally {
    await stop?.();
    anvil.kill();
    rmSync(directory, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nAll margin checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  // Viem errors can contain the RPC URL, so only the first line goes out, with URLs removed.
  const message = String((error as Error).message).split('\n')[0]!.replace(/https?:\/\/\S+/g, '[URL]');
  console.error(`FAILED: ${message}`);
  process.exit(1);
});
