/**
 * Runs the real watcher, inventory and executor against a live chain with test funds.
 * The journal, ledger and signer are stand-ins until the real ones exist.
 *
 * Refuses to run anywhere except Sepolia or a local Anvil chain. See scripts/README.md.
 */
import { NATIVE } from '@cloakroom/shared';
import type { CustodyEOA, LockedWithdrawal } from '@cloakroom/shared';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import { Executor } from '../src/executor.js';
import type { ExpectedTransaction, TransactionSigner } from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { FifoSerialQueue } from '../src/queue.js';
import { DepositWatcher } from '../src/watcher.js';
import type { DepositEvent } from '../src/watcher.js';

const CHAINS = { [sepolia.id]: sepolia, [foundry.id]: foundry } as const;
type AllowedChainId = keyof typeof CHAINS;

const DEPOSIT_AMOUNT = parseEther('0.02');
const SEED_AMOUNT = parseEther('0.02');
const WITHDRAW_AMOUNT = parseEther('0.01');
const GAS_RESERVE = parseEther('0.005');
const MINIMUM_BALANCE = parseEther('0.05');
const NATIVE_TRANSFER_GAS = 21_000n;
const CONFIRMATIONS = 2n;

const SESSION_TTL_SEC = Number(process.env.SMOKE_SESSION_TTL_SEC ?? 90);
const POLL_MS = Number(process.env.SMOKE_POLL_MS ?? 4_000);
const STEP_TIMEOUT_MS = Number(process.env.SMOKE_STEP_TIMEOUT_MS ?? 300_000);

const rpcUrl = process.env.RPC_URL;
const testKey = process.env.TEST_PRIVATE_KEY as Hex | undefined;

/** RPC URLs often contain an API key, so it must never reach the output. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const scrubbed = rpcUrl ? text.replaceAll(rpcUrl, '[RPC_URL]') : text;
  return testKey ? scrubbed.replaceAll(testKey, '[TEST_PRIVATE_KEY]') : scrubbed;
}

let failures = 0;
function check(name: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

async function waitFor(name: string, condition: () => boolean): Promise<boolean> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  check(`${name} within ${STEP_TIMEOUT_MS / 1000}s`, false);
  return false;
}

/** The same rules as the signing guard in the spec, until Felix's KeyManager exists. */
class GuardedSigner implements TransactionSigner {
  private readonly expected = new Map<string, ExpectedTransaction>();
  private readonly signed = new Set<string>();

  constructor(private readonly keys: ReadonlyMap<Address, Hex>) {}

  registerOp(opId: string, expected: ExpectedTransaction): void {
    this.expected.set(opId, expected);
  }

  async sign(
    eoa: Address,
    tx: Parameters<TransactionSigner['sign']>[1],
    opId: string,
  ): Promise<Hex> {
    const expected = this.expected.get(opId);
    const key = this.keys.get(eoa);
    const matches =
      expected?.eoa === eoa &&
      expected.to === tx.to &&
      expected.value === tx.value &&
      expected.dataHash === keccak256(tx.data ?? '0x');
    if (!key || !matches || this.signed.has(opId)) throw new Error('SIGNING_REFUSED');
    this.signed.add(opId);
    return privateKeyToAccount(key).signTransaction(tx);
  }
}

async function main(): Promise<void> {
  if (!rpcUrl || !testKey) throw new Error('Set RPC_URL and TEST_PRIVATE_KEY in .env');

  let requests = 0;
  const transport = http(rpcUrl, {
    onFetchRequest: () => {
      requests += 1;
    },
  });
  const probe = createPublicClient({ transport });
  const chainId = await probe.getChainId();
  if (!(chainId in CHAINS)) {
    throw new Error(`Refusing to run on chain ${chainId}. Only Sepolia or local Anvil is allowed.`);
  }
  const chain = CHAINS[chainId as AllowedChainId];
  const client = createPublicClient({ chain, transport, pollingInterval: POLL_MS, cacheTime: 0 });
  const funder = privateKeyToAccount(testKey);

  // Fixed keys derived from the test key, so a later run can recover funds from a failed one.
  const deriveKey = (label: string): Hex => keccak256(concatHex([testKey, toHex(`smoke:${label}`)]));
  const depositKey = deriveKey('deposit');
  const inventoryKey = deriveKey('inventory');
  const recipientKey = deriveKey('recipient');
  const depositEoa = privateKeyToAccount(depositKey).address;
  const inventoryEoa = privateKeyToAccount(inventoryKey).address;
  const recipient = privateKeyToAccount(recipientKey).address;
  const owner = privateKeyToAccount(deriveKey('owner')).address;

  async function send(key: Hex | 'funder', to: Address, value: bigint): Promise<void> {
    const account = key === 'funder' ? funder : privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain, transport });
    const hash = await wallet.sendTransaction({ to, value });
    await client.waitForTransactionReceipt({ hash });
  }

  async function sweep(): Promise<void> {
    for (const key of [depositKey, inventoryKey, recipientKey]) {
      try {
        const address = privateKeyToAccount(key).address;
        const balance = await client.getBalance({ address });
        const fees = await client.estimateFeesPerGas();
        const gasCost = NATIVE_TRANSFER_GAS * fees.maxFeePerGas;
        if (balance > gasCost) {
          const account = privateKeyToAccount(key);
          const wallet = createWalletClient({ account, chain, transport });
          const hash = await wallet.sendTransaction({
            to: funder.address,
            value: balance - gasCost,
            gas: NATIVE_TRANSFER_GAS,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          });
          await client.waitForTransactionReceipt({ hash });
        }
      } catch (error) {
        console.log(`  Could not return funds yet, so run again to retry: ${describeError(error)}`);
      }
    }
  }

  console.log(`Chain: ${chain.name} (${chainId})`);
  console.log(`Test wallet: ${funder.address}`);
  await sweep();
  const startBalance = await client.getBalance({ address: funder.address });
  console.log(`Balance: ${formatEther(startBalance)} ETH`);
  if (startBalance < MINIMUM_BALANCE) {
    throw new Error(`The test wallet needs at least ${formatEther(MINIMUM_BALANCE)} ETH`);
  }

  const eoas: CustodyEOA[] = [
    { index: 0, address: depositEoa, role: 'deposit', lastUsedAt: 0 },
    { index: 1, address: inventoryEoa, role: 'inventory', lastUsedAt: 0 },
  ];
  const queue = new FifoSerialQueue();
  const journal: DepositEvent[] = [];
  const executorEvents: string[] = [];
  const credits: bigint[] = [];
  const consumed: string[] = [];
  const released: string[] = [];
  const errors: string[] = [];

  const inventory = new Inventory({
    chain: client,
    keys: { list: () => eoas },
    tokens: [],
    gasReserveWei: GAS_RESERVE,
  });
  const watcher = new DepositWatcher({
    chain: client,
    journal: {
      append: async (event) => {
        journal.push(event);
      },
    },
    ledger: { credit: (_owner, _token, amount) => void credits.push(amount) },
    queue,
    confirmations: CONFIRMATIONS,
    onSessionClosed: (eoa) => inventory.markInventory(eoa),
  });
  const executor = new Executor({
    chain: client,
    chainId,
    signer: new GuardedSigner(
      new Map([
        [depositEoa, depositKey],
        [inventoryEoa, inventoryKey],
      ]),
    ),
    inventory,
    journal: {
      append: async (event) => {
        executorEvents.push(event.t);
        return {} as never;
      },
    },
    ledger: {
      consume: (ref) => void consumed.push(ref),
      release: (ref) => void released.push(ref),
    },
    queue,
    confirmations: CONFIRMATIONS,
    receiptTimeoutMs: STEP_TIMEOUT_MS,
    gasMarginPercent: 120n,
    inventorySettleAttempts: 3,
  });

  try {
    console.log('\n1. Seed the inventory address');
    await send('funder', inventoryEoa, SEED_AMOUNT);
    console.log('  Done');

    console.log('\n2. Deposit');
    const head = await client.getBlock();
    await watcher.openSession({
      id: 'smoke-session',
      owner,
      eoa: depositEoa,
      expiry: Number(head.timestamp) + SESSION_TTL_SEC,
    });
    inventory.linkOwner(owner, depositEoa);
    const stop = watcher.start(client, (error) => errors.push(describeError(error)));
    await send('funder', depositEoa, DEPOSIT_AMOUNT);

    if (await waitFor('deposit credited', () => credits.length > 0)) {
      check('credited the exact amount', credits[0] === DEPOSIT_AMOUNT);
    }

    console.log('\n3. Session expiry');
    const closed = await waitFor(
      'session closed',
      () => watcher.getSession('smoke-session')?.open === false,
    );
    stop();
    if (closed) {
      check('credited once', credits.length === 1, `${credits.length} credit(s)`);
      check(
        'journaled opened, credited, closed',
        journal.map((event) => event.t).join() ===
          'DEPOSIT_SESSION_OPENED,DEPOSIT_CREDITED,DEPOSIT_SESSION_CLOSED',
      );
    }

    console.log('\n4. Withdrawal');
    const totalsBefore = (await inventory.getPhysicalBalances()).get(NATIVE) ?? 0n;
    const recipientBefore = await client.getBalance({ address: recipient });
    const withdrawal: LockedWithdrawal = {
      id: 'smoke-withdrawal',
      owner,
      token: NATIVE,
      amount: WITHDRAW_AMOUNT,
      to: recipient,
      status: 'locked',
    };
    const { finished } = await executor.runWithdrawal(withdrawal);
    const outcome = await finished;
    check('confirmed', outcome.status === 'confirmed', outcome.status);

    if (outcome.status === 'confirmed') {
      const receipt = await client.getTransactionReceipt({ hash: outcome.txHash });
      console.log(`  Transaction: ${outcome.txHash}`);
      check('paid by the address the owner did not fund', receipt.from.toLowerCase() === inventoryEoa.toLowerCase());
      const recipientAfter = await client.getBalance({ address: recipient });
      check('recipient received the exact amount', recipientAfter - recipientBefore === WITHDRAW_AMOUNT);
      check('funds consumed, not released', consumed.length === 1 && released.length === 0);
      check(
        'journaled broadcast, confirmed, gas',
        executorEvents.join() === 'WITHDRAWAL_BROADCAST,WITHDRAWAL_CONFIRMED,FEE_BOOKED',
      );
      const totalsAfter = (await inventory.getPhysicalBalances()).get(NATIVE) ?? 0n;
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      check('totals fell by the payout and gas', totalsBefore - totalsAfter === WITHDRAW_AMOUNT + gas);
    }

    check('no RPC errors while watching', errors.length === 0, errors[0] ?? '');
  } finally {
    console.log('\n5. Return test funds');
    await sweep();
    const endBalance = await client.getBalance({ address: funder.address });
    console.log(`  Balance: ${formatEther(endBalance)} ETH`);
    console.log(`  Test cost: ${formatEther(startBalance - endBalance)} ETH`);
    console.log(`\nRPC requests: ${requests}`);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`\nStopped: ${describeError(error)}`);
  process.exitCode = 1;
});
