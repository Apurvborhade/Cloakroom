/**
 * Runs a real swap on Sepolia through the live Trading API and Universal Router, using the real
 * executor, inventory, journal, ledger and queue. The signer is a stand-in, and the journal is a
 * temporary file with a throwaway key.
 *
 * Refuses to run anywhere except Sepolia. Spends test ETH only. See scripts/README.md.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NATIVE } from '@cloakroom/shared';
import type { CustodyEOA, IntentStatus, StoredIntent } from '@cloakroom/shared';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
} from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Executor } from '../src/executor.js';
import type { ExpectedTransaction, TransactionSigner } from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import { UniswapClient } from '../src/uniswap.js';

const SWAP_AMOUNT = parseEther('0.001');
const SEED_AMOUNT = parseEther('0.01');
const GAS_RESERVE = parseEther('0.005');
const MINIMUM_BALANCE = parseEther('0.02');
const NATIVE_TRANSFER_GAS = 21_000n;
const CONFIRMATIONS = 2n;
const TIMEOUT_MS = 300_000;
const ERC20_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

const rpcUrl = process.env.RPC_URL;
const testKey = process.env.TEST_PRIVATE_KEY as Hex | undefined;
const apiKey = process.env.UNISWAP_API_KEY;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

/** RPC URLs and API keys must never reach the output. */
function describeError(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of [rpcUrl, testKey, apiKey]) {
    if (secret) text = text.replaceAll(secret, '[SECRET]');
  }
  return text;
}

let failures = 0;
function check(name: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

class GuardedSigner implements TransactionSigner {
  private readonly expected = new Map<string, ExpectedTransaction>();

  constructor(private readonly keys: ReadonlyMap<Address, Hex>) {}

  registerOp(opId: string, expected: ExpectedTransaction): void {
    this.expected.set(opId, expected);
  }

  async sign(eoa: Address, tx: Parameters<TransactionSigner['sign']>[1], opId: string): Promise<Hex> {
    const expected = this.expected.get(opId);
    const key = this.keys.get(eoa);
    const matches =
      expected?.eoa === eoa &&
      expected.to === tx.to &&
      expected.value === tx.value &&
      expected.dataHash === keccak256(tx.data ?? '0x');
    if (!key || !matches) throw new Error('SIGNING_REFUSED');
    return privateKeyToAccount(key).signTransaction(tx);
  }
}

async function main(): Promise<void> {
  if (!rpcUrl || !testKey) throw new Error('Set RPC_URL and TEST_PRIVATE_KEY in .env');
  const tokenOut = required('TOKEN_OUT_ADDRESS') as Address;
  const tokenOutDecimals = Number(required('TOKEN_OUT_DECIMALS'));
  const routerAddress = required('UNIVERSAL_ROUTER_ADDRESS') as Address;
  const feeBps = Number(required('FEE_BPS'));

  let requests = 0;
  const transport = http(rpcUrl, {
    onFetchRequest: () => {
      requests += 1;
    },
  });
  const probe = createPublicClient({ transport });
  const chainId = await probe.getChainId();
  if (chainId !== sepolia.id) throw new Error(`Refusing to run on chain ${chainId}. Only Sepolia is allowed.`);
  const client = createPublicClient({ chain: sepolia, transport, pollingInterval: 4_000, cacheTime: 0 });

  const funder = privateKeyToAccount(testKey);
  const inventoryKey = keccak256(concatHex([testKey, toHex('smoke:swap-inventory')]));
  const inventoryEoa = privateKeyToAccount(inventoryKey).address;
  const owner = privateKeyToAccount(keccak256(concatHex([testKey, toHex('smoke:swap-owner')]))).address;

  async function returnFunds(): Promise<void> {
    try {
      const balance = await client.getBalance({ address: inventoryEoa });
      const fees = await client.estimateFeesPerGas();
      const gasCost = NATIVE_TRANSFER_GAS * fees.maxFeePerGas;
      if (balance <= gasCost) return;
      const wallet = createWalletClient({
        account: privateKeyToAccount(inventoryKey),
        chain: sepolia,
        transport,
      });
      const hash = await wallet.sendTransaction({
        to: funder.address,
        value: balance - gasCost,
        gas: NATIVE_TRANSFER_GAS,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      await client.waitForTransactionReceipt({ hash });
    } catch (error) {
      console.log(`  Could not return ETH yet, so run again to retry: ${describeError(error)}`);
    }
  }

  console.log(`Test wallet: ${funder.address}`);
  console.log(`Swap address: ${inventoryEoa}`);
  await returnFunds();
  const startBalance = await client.getBalance({ address: funder.address });
  console.log(`Balance: ${formatEther(startBalance)} ETH`);
  if (startBalance < MINIMUM_BALANCE) {
    throw new Error(`The test wallet needs at least ${formatEther(MINIMUM_BALANCE)} ETH`);
  }

  const eoas: CustodyEOA[] = [{ index: 0, address: inventoryEoa, role: 'inventory', lastUsedAt: 0 }];
  const inventory = new Inventory({
    chain: client,
    keys: { list: () => eoas },
    tokens: [tokenOut],
    gasReserveWei: GAS_RESERVE,
  });
  const ledger = new InMemoryLedger();
  const journalDirectory = await mkdtemp(join(tmpdir(), 'cloakroom-smoke-'));
  const journal = new EncryptedJournal({ filePath: join(journalDirectory, 'smoke.journal'), key: randomBytes(32) });
  const marks: IntentStatus[] = [];
  const executor = new Executor({
    chain: client,
    chainId,
    signer: new GuardedSigner(new Map([[inventoryEoa, inventoryKey]])),
    inventory,
    journal,
    ledger,
    queue: new FifoSerialQueue(),
    confirmations: CONFIRMATIONS,
    receiptTimeoutMs: TIMEOUT_MS,
    gasMarginPercent: 120n,
    inventorySettleAttempts: 3,
    swaps: {
      quoter: new UniswapClient({
        apiUrl: required('UNISWAP_API_URL'),
        apiKey: required('UNISWAP_API_KEY'),
        chainId,
        timeoutMs: Number(required('PRICE_QUOTE_TIMEOUT_MS')),
      }),
      intents: { mark: (_id, status) => void marks.push(status) },
      ledger,
      routerAddress,
      tokenOut,
      tokenOutDecimals,
      feeBps,
      maxSlippageBpsCap: Number(required('MAX_SLIPPAGE_BPS_CAP')),
    },
  });

  const intent: StoredIntent['intent'] = {
    owner,
    tokenIn: NATIVE,
    tokenOut,
    amountIn: SWAP_AMOUNT,
    comparator: 0,
    triggerPrice: 1n,
    maxSlippageBps: 100,
    nonce: 1n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };
  const stored: StoredIntent = { id: `smoke-${Date.now()}`, owner, intent, status: 'pending', createdAt: 0 };

  try {
    const setupEvents = [
      { t: 'DEPOSIT_CREDITED', id: 'smoke-deposit', owner, amount: SWAP_AMOUNT, block: 1n },
      { t: 'INTENT_CREATED', id: stored.id, owner, intent },
    ] as const;
    for (const event of setupEvents) {
      await journal.append(event);
      ledger.apply(event);
    }

    console.log('\n1. Seed the swap address');
    const wallet = createWalletClient({ account: funder, chain: sepolia, transport });
    const seedHash = await wallet.sendTransaction({ to: inventoryEoa, value: SEED_AMOUNT });
    await client.waitForTransactionReceipt({ hash: seedHash });
    console.log('  Done');

    console.log('\n2. Swap through the live Trading API and Universal Router');
    const before = await client.readContract({
      address: tokenOut,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [inventoryEoa],
    });
    const outcome = await executor.runIntent(stored);
    console.log(`  Outcome: ${outcome.status}${'reason' in outcome ? ` (${outcome.reason})` : ''}`);
    check('settled', outcome.status === 'settled');

    if (outcome.status === 'settled') {
      console.log(`  Transaction: ${outcome.txHash}`);
      console.log(`  Output: ${formatUnits(outcome.amountOut, tokenOutDecimals)} tokens`);
      const receipt = await client.getTransactionReceipt({ hash: outcome.txHash });
      check('sent by the swap address', receipt.from.toLowerCase() === inventoryEoa.toLowerCase());
      check('sent to the pinned router', receipt.to?.toLowerCase() === routerAddress.toLowerCase());
      const after = await client.readContract({
        address: tokenOut,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [inventoryEoa],
      });
      check('on-chain balance rose by the settled output', after - before === outcome.amountOut);
      check('owner credited the output minus the fee', ledger.getBalance(owner, tokenOut).available === outcome.amountOut - outcome.fee);
      check('reserved ETH consumed', ledger.getBalance(owner, NATIVE).reserved === 0n);
      check('fee booked as revenue', ledger.getProtocolRevenue(tokenOut) === outcome.fee);
      const events: string[] = [];
      for await (const entry of journal.replay()) events.push(entry.event.t);
      check(
        'journaled funding, order, broadcast, settled, gas',
        events.join() === 'DEPOSIT_CREDITED,INTENT_CREATED,EXEC_BROADCAST,EXEC_SETTLED,FEE_BOOKED',
      );
      const rebuilt = await replayLedger(journal);
      check(
        'replaying the journal rebuilds the owner balance',
        rebuilt.getBalance(owner, tokenOut).available === ledger.getBalance(owner, tokenOut).available,
      );
      check('status went executing, then done', marks.join() === 'executing,done');
    }
  } finally {
    await journal.close();
    await rm(journalDirectory, { recursive: true, force: true });
    console.log('\n3. Return test ETH');
    await returnFunds();
    const endBalance = await client.getBalance({ address: funder.address });
    console.log(`  Balance: ${formatEther(endBalance)} ETH`);
    console.log(`  ETH spent: ${formatEther(startBalance - endBalance)}. The swapped tokens stay at the swap address.`);
    console.log(`\nRPC requests: ${requests}`);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`\nStopped: ${describeError(error)}`);
  process.exitCode = 1;
});
