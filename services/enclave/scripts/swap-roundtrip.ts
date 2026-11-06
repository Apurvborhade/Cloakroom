/**
 * Alice signs an order to sell ETH for the output token, and the running service runs it: its price
 * check triggers the order, and the real signer signs a swap through the real Uniswap router.
 *
 * Uses the balance left by `pnpm test:roundtrip`, and the pool addresses that run created. With
 * --preview it only reads the price and balance, and signs no order. See scripts/README.md.
 */
import {
  createDomain,
  deriveEnclaveSalt,
  EIP712_TYPES,
  NATIVE,
  sealEnvelopeWithResponse,
} from '@cloakroom/shared';
import {
  concatHex,
  createPublicClient,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbiItem,
  parseEther,
  toHex,
} from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { priceFromQuote } from '../src/price-poller.js';
import { UniswapClient } from '../src/uniswap.js';

const SWAP_AMOUNT = parseEther('0.001');
const LIMIT_PERCENT_OF_PRICE = 90n;
const MAX_SLIPPAGE_BPS = 100;
const POLL_MS = 10_000;
const ORDER_EXPIRY_MARGIN_SEC = 20;
const SETTLE_GRACE_MS = 3 * 60_000;
const LOG_CHUNK_BLOCKS = 10n;
const BPS = 10_000n;
const PRICE_SCALE = 10n ** 18n;
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const SECRET_NAMES = ['RPC_URL', 'TEST_PRIVATE_KEY', 'UNISWAP_API_KEY'];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

function describeError(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const name of SECRET_NAMES) {
    const secret = process.env[name];
    if (secret) text = text.replaceAll(secret, `[${name}]`);
  }
  return text;
}

let failures = 0;
function check(name: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const preview = process.argv.includes('--preview');
  const testKey = required('TEST_PRIVATE_KEY') as Hex;
  const baseUrl = `http://${required('HOST')}:${required('PORT')}`;
  const transport = http(required('RPC_URL'));
  const chainId = await createPublicClient({ transport }).getChainId();
  if (chainId !== sepolia.id) throw new Error(`Refusing to run on chain ${chainId}. Only Sepolia.`);
  const client = createPublicClient({ chain: sepolia, transport, cacheTime: 0 });
  const tokenOut = getAddress(required('TOKEN_OUT_ADDRESS'));
  const decimals = Number(required('TOKEN_OUT_DECIMALS'));
  const router = getAddress(required('UNIVERSAL_ROUTER_ADDRESS'));
  const feeBps = BigInt(required('FEE_BPS'));

  // The same user as `pnpm test:roundtrip`, so the balance it left is here.
  const alice = privateKeyToAccount(keccak256(concatHex([testKey, toHex('roundtrip:alice')])));

  const keyResponse = await fetch(`${baseUrl}/sim/enclave-key`).catch(() => undefined);
  if (!keyResponse) throw new Error(`No service at ${baseUrl}. Start it with: pnpm start:enclave`);
  if (!keyResponse.ok) throw new Error('The service is not in simulation mode. Set SIM_MODE=true.');
  const { enclavePubKey } = (await keyResponse.json()) as { enclavePubKey: Hex };
  const domain = createDomain(chainId, deriveEnclaveSalt(enclavePubKey));

  const post = async (path: string, payload: unknown) => {
    const { envelope, openResponse } = await sealEnvelopeWithResponse(payload, { path, chainId, enclavePubKey });
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`${path} was refused: ${String(body.error)}`);
    return (await openResponse(body as never)) as Record<string, unknown>;
  };

  const now = () => Math.floor(Date.now() / 1000);
  const sessionKey = privateKeyToAccount(generatePrivateKey());
  const grantExpiry = now() + Number(required('SESSION_GRANT_TTL_SEC')) - ORDER_EXPIRY_MARGIN_SEC;
  await post('/session', {
    message: { owner: alice.address, sessionKey: sessionKey.address, expiry: String(grantExpiry) },
    signature: await alice.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'SessionGrant',
      message: { owner: alice.address, sessionKey: sessionKey.address, expiry: BigInt(grantExpiry) },
    }),
  });
  const read = async (path: string) => {
    const expiry = now() + 120;
    return post(path, {
      message: { owner: alice.address, expiry: String(expiry) },
      signature: await sessionKey.signTypedData({
        domain,
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: { owner: alice.address, expiry: BigInt(expiry) },
      }),
    });
  };
  const balances = async () => {
    const { balances: items } = await read('/balance');
    const find = (token: Address) =>
      BigInt((items as Array<{ token: Address; available: string }>).find((item) => item.token === token)?.available ?? 0);
    return { eth: find(NATIVE), token: find(tokenOut) };
  };

  const quoter = new UniswapClient({
    apiUrl: required('UNISWAP_API_URL'),
    apiKey: required('UNISWAP_API_KEY'),
    chainId,
    timeoutMs: Number(required('PRICE_QUOTE_TIMEOUT_MS')),
  });
  const swapper = privateKeyToAccount(generatePrivateKey()).address;
  const priceFor = async (amountIn: bigint) => {
    const quote = await quoter.quote({ tokenIn: NATIVE, tokenOut, amountIn, swapper });
    return priceFromQuote(quote.amountIn, quote.amountOut, decimals);
  };
  // The service's price check uses its reference amount, and thin pools price sizes differently.
  // The limit sits under both, so the check triggers the order and the swap still meets it.
  const [swapPrice, checkPrice] = await Promise.all([
    priceFor(SWAP_AMOUNT),
    priceFor(BigInt(required('PRICE_REFERENCE_AMOUNT_WEI'))),
  ]);
  const lowest = swapPrice < checkPrice ? swapPrice : checkPrice;
  const limit = (lowest * LIMIT_PERCENT_OF_PRICE) / 100n;
  const start = await balances();

  const usd = (price: bigint) => formatUnits(price, 18);
  console.log(`Alice: ${alice.address}`);
  console.log(`Alice's private balance: ${formatEther(start.eth)} ETH, ${formatUnits(start.token, decimals)} tokens`);
  console.log(`Price for this swap: ${usd(swapPrice)} tokens per ETH`);
  console.log(`Price the service checks: ${usd(checkPrice)} tokens per ETH`);
  console.log(`Order: sell ${formatEther(SWAP_AMOUNT)} ETH if the price is at least ${usd(limit)}`);
  if (start.eth < SWAP_AMOUNT) throw new Error('Alice has too little ETH. Run pnpm test:roundtrip first.');
  if (preview) {
    console.log('\nPreview only: no order was signed. Run without --preview to swap.');
    return;
  }

  console.log('\n1. Sign the order');
  const startBlock = await client.getBlockNumber();
  const expiry = now() + Number(required('MAX_EXPIRY_FUTURE_SEC')) - ORDER_EXPIRY_MARGIN_SEC;
  const nonce = BigInt(Date.now());
  const message = {
    owner: alice.address,
    tokenIn: NATIVE,
    tokenOut,
    amountIn: SWAP_AMOUNT,
    comparator: 0,
    triggerPrice: limit,
    maxSlippageBps: MAX_SLIPPAGE_BPS,
    nonce,
    expiry: BigInt(expiry),
  };
  const { intentId } = await post('/intents', {
    message: {
      ...message,
      amountIn: String(SWAP_AMOUNT),
      triggerPrice: String(limit),
      nonce: String(nonce),
      expiry: String(expiry),
    },
    signature: await alice.signTypedData({ domain, types: EIP712_TYPES, primaryType: 'Intent', message }),
  });
  const reserved = await balances();
  check('The funds are reserved', reserved.eth === start.eth - SWAP_AMOUNT);

  console.log(`\n2. Wait for the service's next price check, every ${required('PRICE_POLL_INTERVAL_SEC')}s`);
  const deadline = expiry * 1000 + SETTLE_GRACE_MS;
  let status = 'pending';
  let amountOut: string | undefined;
  while (Date.now() < deadline) {
    const { intents } = await read('/intents/status');
    const order = (intents as Array<{ id: string; status: string; amountOut?: string }>).find(({ id }) => id === intentId);
    if (order && order.status !== status) console.log(`  Status: ${order.status}`);
    status = order?.status ?? status;
    amountOut = order?.amountOut;
    if (['done', 'failed', 'cancelled', 'expired'].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  console.log('\n3. Check the result');
  check('The order settled', status === 'done', status);
  if (status !== 'done' || amountOut === undefined) {
    if (status === 'expired') console.log('  No pool address could run it in time, or the price check kept failing.');
    const after = await balances();
    check('The funds came back', after.eth === start.eth, `${formatEther(after.eth)} ETH`);
    process.exitCode = 1;
    return;
  }

  const credited = BigInt(amountOut);
  const after = await balances();
  check('Alice paid the ETH', after.eth === start.eth - SWAP_AMOUNT, `${formatEther(after.eth)} ETH`);
  check('Alice was credited the tokens', after.token === start.token + credited, `${formatUnits(after.token, decimals)} tokens`);
  const owed = (SWAP_AMOUNT * limit * 10n ** BigInt(decimals)) / (PRICE_SCALE * 10n ** 18n);
  check('She got at least her limit, after the fee', credited >= owed, `${formatUnits(credited, decimals)} against ${formatUnits(owed, decimals)}`);

  // The API never reveals which pool address ran a swap, so find it on-chain by the amount.
  const latest = await client.getBlockNumber();
  for (let from = startBlock; from <= latest; from += LOG_CHUNK_BLOCKS) {
    const to = from + LOG_CHUNK_BLOCKS - 1n < latest ? from + LOG_CHUNK_BLOCKS - 1n : latest;
    const logs = await client.getLogs({ address: tokenOut, event: TRANSFER, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const value = log.args.value ?? 0n;
      if (value - (value * feeBps) / BPS !== credited) continue;
      const transaction = await client.getTransaction({ hash: log.transactionHash });
      if (!transaction.to || getAddress(transaction.to) !== router) continue;
      check('It went through the Uniswap router', true, transaction.to);
      console.log(`  Sent from: ${transaction.from}. Compare it with Alice's deposit address in the round trip output.`);
      console.log(`  https://sepolia.etherscan.io/tx/${log.transactionHash}`);
      from = latest + 1n;
      break;
    }
  }

  console.log(failures === 0 ? '\nAll checks passed. The real signer swapped through Uniswap.' : `\n${failures} check(s) failed.`);
  console.log('This run was TEE-simulated, so it makes no confidentiality claim.');
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`\nStopped: ${describeError(error)}`);
  process.exitCode = 1;
});
