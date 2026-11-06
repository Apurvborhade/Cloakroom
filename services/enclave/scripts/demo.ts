import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EIP712_TYPES, NATIVE } from '@cloakroom/shared';
import type {
  CustodyEOA,
  IntentStatus,
  JournalEvent,
  LockedWithdrawal,
  PriceReport,
  StoredIntent,
} from '@cloakroom/shared';
import { concatHex, createWalletClient, formatEther, formatUnits, getAddress, keccak256, toHex } from 'viem';
import type { Address, Chain, Hex, PublicClient, Transport } from 'viem';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import { AuthError, AuthService } from '../src/auth.js';
import { Executor } from '../src/executor.js';
import type { ExpectedTransaction, SwapOutcome, TransactionSigner } from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { PricePoller } from '../src/price-poller.js';
import { FifoSerialQueue } from '../src/queue.js';
import type { Quote, QuoteRequest } from '../src/uniswap.js';
import { DepositWatcher } from '../src/watcher.js';
import { fundInventory } from './seeding.js';
import type { SeedChain } from './seeding.js';

/** Only used to derive the signing domain, because this demo runs outside a real enclave. */
const DEMO_ENCLAVE_KEY = keccak256(toHex('cloakroom-demo-enclave'));
const MAX_SLIPPAGE_BPS = 100;
const TRIGGER_PERCENT_OF_PRICE = 90n;
const REQUEST_LIFETIME_SEC = 200n;
const GAS_MARGIN_PERCENT = 120n;
const SETTLE_ATTEMPTS = 3;
const NATIVE_TRANSFER_GAS = 21_000n;

export interface DemoOptions {
  client: PublicClient;
  chain: Chain;
  transport: Transport;
  /** Funds the demo. Its address appears on-chain as the operator and as a source of user funds. */
  funderKey: Hex;
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
  routerAddress: Address;
  tokenOut: Address;
  tokenOutDecimals: number;
  feeBps: number;
  gasReserveWei: bigint;
  /** ETH each inventory address holds, above its gas reserve. */
  inventoryEthWei: bigint;
  /** Output token each inventory address holds, so a payout does not rely on a lucky swap. */
  inventoryTokenUnits: bigint;
  depositWei: bigint;
  swapWei: bigint;
  sessionTtlSec: number;
  pollIntervalSec: number;
  receiptTimeoutMs: number;
  confirmations: bigint;
  explorerTxUrl?: string;
  log: (line: string) => void;
}

export interface DemoCheck {
  name: string;
  passed: boolean;
}

export interface DemoResult {
  checks: DemoCheck[];
  swapTxHash?: Hex;
  payoutTxHash?: Hex;
}

/** A plain stand-in until Shreyas's IntentStore exists. */
class DemoIntentStore {
  private readonly intents = new Map<string, StoredIntent>();

  add(stored: StoredIntent): void {
    this.intents.set(stored.id, stored);
  }

  /** Pending intents whose price condition this report meets. */
  due(report: PriceReport): StoredIntent[] {
    return [...this.intents.values()].filter((stored) => {
      if (stored.status !== 'pending') return false;
      const { comparator, triggerPrice } = stored.intent;
      return comparator === 0 ? report.price >= triggerPrice : false;
    });
  }

  mark(id: string, status: IntentStatus, amountOut?: bigint): void {
    const stored = this.intents.get(id);
    if (stored) this.intents.set(id, { ...stored, status, settledAmountOut: amountOut });
  }
}

/** A stand-in with the rules of the signing guard, until KeyManager allows swaps. */
class DemoSigner implements TransactionSigner {
  private readonly expected = new Map<string, ExpectedTransaction>();
  private readonly signed = new Set<string>();

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
    if (!key || !matches || this.signed.has(opId)) throw new Error('SIGNING_REFUSED');
    this.signed.add(opId);
    return privateKeyToAccount(key).signTransaction(tx);
  }
}

async function waitUntil(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const rejectionCode = (error: unknown): string =>
  error instanceof AuthError ? error.code : error instanceof Error ? error.message : 'UNKNOWN';

/**
 * Runs the demo script: two users deposit, one swaps and withdraws, and three attacks fail.
 * It uses the real auth, journal, ledger, queue, watcher, inventory, price poller and executor.
 * The signer and intent store are stand-ins, nothing runs in a TEE, and there is no API or UI.
 */
export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  const { client, chain, confirmations, log, tokenOut, tokenOutDecimals, transport } = options;
  const checks: DemoCheck[] = [];
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed });
    log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}`);
  };
  const tokens = (amount: bigint) => formatUnits(amount, tokenOutDecimals);
  const link = (hash: Hex) => (options.explorerTxUrl ? `${options.explorerTxUrl}${hash}` : hash);

  // Fixed keys derived from the funder, so a later run can return funds from a failed one.
  const derive = (label: string): Hex =>
    keccak256(concatHex([options.funderKey, toHex(`demo:${label}`)]));
  const funder = privateKeyToAccount(options.funderKey);
  const alice = privateKeyToAccount(derive('alice'));
  const bob = privateKeyToAccount(derive('bob'));
  const aliceNewWallet = privateKeyToAccount(derive('alice-new-wallet')).address;
  const bobNewWallet = privateKeyToAccount(derive('bob-new-wallet')).address;
  const custodyKeys = {
    depositAlice: derive('deposit-alice'),
    depositBob: derive('deposit-bob'),
    inventoryOne: derive('inventory-1'),
    inventoryTwo: derive('inventory-2'),
  };
  const addressOf = (key: Hex) => privateKeyToAccount(key).address;
  const depositAlice = addressOf(custodyKeys.depositAlice);
  const depositBob = addressOf(custodyKeys.depositBob);
  const inventoryOne = addressOf(custodyKeys.inventoryOne);
  const inventoryTwo = addressOf(custodyKeys.inventoryTwo);

  const custody: CustodyEOA[] = [
    { index: 0, address: inventoryOne, role: 'inventory', lastUsedAt: 0 },
    { index: 1, address: inventoryTwo, role: 'inventory', lastUsedAt: 0 },
    { index: 2, address: depositAlice, role: 'deposit', lastUsedAt: 0 },
    { index: 3, address: depositBob, role: 'deposit', lastUsedAt: 0 },
  ];

  const sendEth = async (key: Hex, to: Address, value: bigint): Promise<void> => {
    const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport });
    const hash = await wallet.sendTransaction({ to, value });
    await client.waitForTransactionReceipt({ hash });
  };

  const returnEth = async (): Promise<void> => {
    const keys = [...Object.values(custodyKeys), derive('alice'), derive('bob'), derive('bob-new-wallet')];
    for (const key of keys) {
      try {
        const address = addressOf(key);
        const balance = await client.getBalance({ address });
        const fees = await client.estimateFeesPerGas();
        const gasCost = NATIVE_TRANSFER_GAS * fees.maxFeePerGas;
        if (balance <= gasCost) continue;
        const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport });
        const hash = await wallet.sendTransaction({
          to: funder.address,
          value: balance - gasCost,
          gas: NATIVE_TRANSFER_GAS,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
        await client.waitForTransactionReceipt({ hash });
      } catch {
        log('  Could not return some test ETH yet. Run the demo again to recover it.');
      }
    }
  };

  const directory = mkdtempSync(join(tmpdir(), 'cloakroom-demo-'));
  const journal = new EncryptedJournal({ filePath: join(directory, 'journal.bin'), key: randomBytes(32) });
  const ledger = new InMemoryLedger();
  const queue = new FifoSerialQueue();
  const auth = new AuthService({
    chainId: chain.id,
    enclavePubKey: DEMO_ENCLAVE_KEY,
    config: { sessionGrantTtlSec: 1800, maxExpiryFutureSec: 300, maxClockSkewSec: 60 },
    queue,
    journal,
    ledger,
  });
  const store = new DemoIntentStore();
  const inventory = new Inventory({
    chain: client,
    keys: { list: () => custody },
    tokens: [tokenOut],
    gasReserveWei: options.gasReserveWei,
  });
  const watcher = new DepositWatcher({
    chain: client,
    journal,
    ledger,
    queue,
    confirmations,
    onSessionClosed: (eoa) => inventory.markInventory(eoa),
  });
  const executor = new Executor({
    chain: client,
    chainId: chain.id,
    signer: new DemoSigner(new Map(Object.values(custodyKeys).map((key) => [addressOf(key), key]))),
    inventory,
    journal,
    ledger,
    queue,
    confirmations,
    receiptTimeoutMs: options.receiptTimeoutMs,
    gasMarginPercent: GAS_MARGIN_PERCENT,
    inventorySettleAttempts: SETTLE_ATTEMPTS,
    swaps: {
      quoter: options.quoter,
      intents: { mark: (id, status, amountOut) => store.mark(id, status, amountOut) },
      ledger,
      routerAddress: options.routerAddress,
      tokenOut,
      tokenOutDecimals,
      feeBps: options.feeBps,
      maxSlippageBpsCap: MAX_SLIPPAGE_BPS,
    },
  });

  let nonce = 0n;
  const nextNonce = () => {
    nonce += 1n;
    return nonce;
  };
  const expiry = () => BigInt(Math.floor(Date.now() / 1000)) + REQUEST_LIFETIME_SEC;
  const domain = auth.getDomain();

  const lockWithdrawal = (withdrawal: LockedWithdrawal) =>
    queue.run(async () => {
      if (ledger.getBalance(withdrawal.owner, withdrawal.token).available < withdrawal.amount) {
        throw new Error('INSUFFICIENT_BALANCE');
      }
      const event: JournalEvent = {
        t: 'WITHDRAWAL_LOCKED',
        id: withdrawal.id,
        owner: withdrawal.owner,
        token: withdrawal.token,
        amount: withdrawal.amount,
        to: withdrawal.to,
      };
      await journal.append(event);
      ledger.apply(event);
    });

  const result: DemoResult = { checks };
  const stopFns: Array<() => void> = [];

  try {
    await returnEth();

    log('\n1. Trust model');
    log('  One enclave holds every key and the whole ledger. Users trust it and its operator.');
    log('  This run is TEE-simulated: it is not inside an enclave, so it makes no confidentiality claim.');

    log('\nOperator seeds the inventory, which we disclose openly.');
    const walletClient = createWalletClient({ account: funder, chain, transport });
    await fundInventory({
      chain: client as unknown as SeedChain,
      wallet: { address: funder.address, send: (tx) => walletClient.sendTransaction(tx) },
      addresses: [inventoryOne, inventoryTwo],
      tokenOut,
      targets: { nativeWei: options.inventoryEthWei, tokenUnits: options.inventoryTokenUnits },
      gasReserveWei: options.gasReserveWei,
      gasBufferWei: options.depositWei * 4n,
      swap: { quoter: options.quoter, routerAddress: options.routerAddress, priceCheckWei: options.swapWei },
      execute: true,
    });
    for (const user of [alice, bob]) {
      const balance = await client.getBalance({ address: user.address });
      const wanted = options.depositWei * 2n;
      if (balance < wanted) await sendEth(options.funderKey, user.address, wanted - balance);
    }
    log('  Done');

    log('\n2. Alice and Bob deposit from different wallets');
    stopFns.push(watcher.start(client, (error) => log(`  Watcher error: ${rejectionCode(error)}`)));
    const head = await client.getBlock();
    const sessionExpiry = Number(head.timestamp) + options.sessionTtlSec;
    for (const [user, eoa, id] of [
      [alice, depositAlice, 'session-alice'],
      [bob, depositBob, 'session-bob'],
    ] as const) {
      const message = { owner: user.address, asset: NATIVE, nonce: nextNonce(), expiry: expiry() };
      const signature = await user.signTypedData({ domain, types: EIP712_TYPES, primaryType: 'DepositRequest', message });
      await auth.verifyAndAuthorizeMutation('DepositRequest', message, signature);
      await watcher.openSession({ id, owner: user.address, eoa, expiry: sessionExpiry });
      inventory.linkOwner(user.address, eoa);
      await sendEth(user === alice ? derive('alice') : derive('bob'), eoa, options.depositWei);
      log(`  ${user === alice ? 'Alice' : 'Bob'} sent ${formatEther(options.depositWei)} ETH to their deposit address`);
    }
    const creditTimeout = options.receiptTimeoutMs;
    await waitUntil(
      () =>
        ledger.getBalance(alice.address, NATIVE).available === options.depositWei &&
        ledger.getBalance(bob.address, NATIVE).available === options.depositWei,
      creditTimeout,
      'deposits to be credited',
    );

    log('\n3. Confidential balances, which only the enclave knows');
    log(`  Alice: ${formatEther(ledger.getBalance(alice.address, NATIVE).available)} ETH`);
    log(`  Bob: ${formatEther(ledger.getBalance(bob.address, NATIVE).available)} ETH`);
    check('each deposit credited exactly once', true);

    log('\n4. Alice signs a conditional swap');
    const firstQuote = await options.quoter.quote({
      tokenIn: NATIVE,
      tokenOut,
      amountIn: options.swapWei,
      swapper: privateKeyToAddress(generatePrivateKey()),
    });
    const scale = 10n ** 36n / 10n ** BigInt(tokenOutDecimals);
    const marketPrice = (firstQuote.amountOut * scale) / options.swapWei;
    // Set just below the price, so the next check triggers it. Testnet pools do not track the market.
    const triggerPrice = (marketPrice * TRIGGER_PERCENT_OF_PRICE) / 100n;
    const intent: StoredIntent['intent'] = {
      owner: alice.address,
      tokenIn: NATIVE,
      tokenOut,
      amountIn: options.swapWei,
      comparator: 0,
      triggerPrice,
      maxSlippageBps: MAX_SLIPPAGE_BPS,
      nonce: nextNonce(),
      expiry: expiry(),
    };
    const intentSignature = await alice.signTypedData({ domain, types: EIP712_TYPES, primaryType: 'Intent', message: intent });
    await auth.verifyAndAuthorizeMutation('Intent', intent, intentSignature);
    const created: JournalEvent = { t: 'INTENT_CREATED', id: 'demo-intent', owner: alice.address, intent };
    await journal.append(created);
    ledger.apply(created);
    const stored: StoredIntent = {
      id: 'demo-intent',
      owner: alice.address,
      intent,
      status: 'pending',
      createdAt: Math.floor(Date.now() / 1000),
    };
    store.add(stored);
    log('  The order and its trigger price stay inside the enclave');

    log("  The enclave's next price check triggers it");
    let swapOutcome: SwapOutcome | undefined;
    const poller = new PricePoller({
      quoter: options.quoter,
      tokenOut,
      tokenOutDecimals,
      referenceAmountWei: options.swapWei,
      intervalSec: options.pollIntervalSec,
      swapper: privateKeyToAddress(generatePrivateKey()),
      onReport: (report) => {
        for (const due of store.due(report)) {
          void executor.runIntent(due).then((outcome) => {
            if (outcome.status !== 'pending') swapOutcome = outcome;
          });
        }
      },
      onError: (error) => log(`  Price check failed, retrying: ${rejectionCode(error)}`),
    });
    stopFns.push(poller.start());
    await waitUntil(() => swapOutcome !== undefined, options.receiptTimeoutMs, 'the swap to settle');

    log('\n5. The swap, from an address neither user funded');
    const settled = swapOutcome as SwapOutcome | undefined;
    if (settled?.status !== 'settled') {
      check('swap settled', false);
      return result;
    }
    result.swapTxHash = settled.txHash;
    const swapReceipt = await client.getTransactionReceipt({ hash: settled.txHash });
    log(`  ${link(settled.txHash)}`);
    log(`  Output: ${tokens(settled.amountOut)} tokens`);
    const sender = getAddress(swapReceipt.from);
    check('swap settled', true);
    check('sent from an inventory address', sender === inventoryOne || sender === inventoryTwo);
    check('not sent from either deposit address', sender !== depositAlice && sender !== depositBob);
    check('not sent from either user wallet', sender !== alice.address && sender !== bob.address);
    check(
      "Alice's balance is the output minus the fee",
      ledger.getBalance(alice.address, tokenOut).available === settled.amountOut - settled.fee,
    );

    log('\n6. Alice withdraws to a fresh wallet');
    const payoutAmount = ledger.getBalance(alice.address, tokenOut).available / 2n;
    const withdrawalMessage = {
      owner: alice.address,
      token: tokenOut,
      amount: payoutAmount,
      to: aliceNewWallet,
      nonce: nextNonce(),
      expiry: expiry(),
    };
    const withdrawalSignature = await alice.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Withdrawal',
      message: withdrawalMessage,
    });
    await auth.verifyAndAuthorizeMutation('Withdrawal', withdrawalMessage, withdrawalSignature);
    const aliceWithdrawal: LockedWithdrawal = {
      id: 'demo-withdrawal',
      owner: alice.address,
      token: tokenOut,
      amount: payoutAmount,
      to: aliceNewWallet,
      status: 'locked',
    };
    await lockWithdrawal(aliceWithdrawal);
    const { finished } = await executor.runWithdrawal(aliceWithdrawal);
    const payout = await finished;
    if (payout.status !== 'confirmed') {
      check('payout confirmed', false);
      return result;
    }
    result.payoutTxHash = payout.txHash;
    const payoutReceipt = await client.getTransactionReceipt({ hash: payout.txHash });
    log(`  ${link(payout.txHash)}`);
    log(`  The new wallet received ${tokens(payoutAmount)} tokens in a normal transfer`);
    const payer = getAddress(payoutReceipt.from);
    check('payout confirmed', true);
    check('paid from an address not linked to Alice', payer !== sender && payer !== depositAlice);

    log('\n7. Attacks');
    let replayCode = 'NOT_REJECTED';
    try {
      await auth.verifyAndAuthorizeMutation('Withdrawal', withdrawalMessage, withdrawalSignature);
    } catch (error) {
      replayCode = rejectionCode(error);
    }
    log(`  Resending the same signed withdrawal: rejected with ${replayCode}`);
    check('replay rejected', replayCode === 'NONCE_USED');

    const attacker = privateKeyToAddress(generatePrivateKey());
    let tamperCode = 'NOT_REJECTED';
    try {
      await auth.verifyAndAuthorizeMutation(
        'Withdrawal',
        { ...withdrawalMessage, to: attacker, nonce: nextNonce() },
        withdrawalSignature,
      );
    } catch (error) {
      tamperCode = rejectionCode(error);
    }
    log(`  Changing the destination after signing: rejected with ${tamperCode}`);
    check('wrong destination rejected', tamperCode === 'BAD_SIGNATURE');

    const bobEightyPercent = (options.depositWei * 8n) / 10n;
    const signBobWithdrawal = async () => {
      const message = {
        owner: bob.address,
        token: NATIVE,
        amount: bobEightyPercent,
        to: bobNewWallet,
        nonce: nextNonce(),
        expiry: expiry(),
      };
      const signature = await bob.signTypedData({ domain, types: EIP712_TYPES, primaryType: 'Withdrawal', message });
      return { message, signature };
    };
    const bobFirst = await signBobWithdrawal();
    const bobSecond = await signBobWithdrawal();
    const attempts = await Promise.allSettled(
      [
        { signed: bobFirst, id: 'demo-bob-1' },
        { signed: bobSecond, id: 'demo-bob-2' },
      ].map(async ({ signed, id }) => {
        await auth.verifyAndAuthorizeMutation('Withdrawal', signed.message, signed.signature);
        await lockWithdrawal({
          id,
          owner: bob.address,
          token: NATIVE,
          amount: bobEightyPercent,
          to: bobNewWallet,
          status: 'locked',
        });
        return id;
      }),
    );
    const accepted = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const refused = attempts.filter((attempt) => attempt.status === 'rejected');
    log(`  Two withdrawals of 80% of a balance at once: ${accepted.length} accepted, ${refused.length} rejected`);
    check('double spend rejected', accepted.length === 1 && refused.length === 1);
    check('Bob cannot go negative', ledger.getBalance(bob.address, NATIVE).available >= 0n);

    log('\nDeposit addresses join the pool when their sessions end');
    await waitUntil(
      () =>
        watcher.getSession('session-alice')?.open === false &&
        watcher.getSession('session-bob')?.open === false,
      options.receiptTimeoutMs,
      'deposit sessions to close',
    );
    check('deposit sessions closed', true);
    for (const stop of stopFns.splice(0)) stop();

    log('\n8. The books still balance');
    const physical = await inventory.getPhysicalBalances();
    for (const [token, totals] of ledger.totals()) {
      const claims = totals.available + totals.reserved;
      const held = physical.get(getAddress(token)) ?? 0n;
      const name = getAddress(token) === getAddress(NATIVE) ? 'ETH' : 'token';
      check(`on-chain ${name} covers every claim`, held >= claims);
    }
    const rebuilt = await replayLedger(journal);
    check(
      'a ledger rebuilt from the journal matches the live one',
      [alice.address, bob.address].every(
        (owner) =>
          JSON.stringify(rebuilt.getBalance(owner, NATIVE), bigintToString) ===
            JSON.stringify(ledger.getBalance(owner, NATIVE), bigintToString) &&
          JSON.stringify(rebuilt.getBalance(owner, tokenOut), bigintToString) ===
            JSON.stringify(ledger.getBalance(owner, tokenOut), bigintToString),
      ),
    );

    log('\nKnown leaks to state openly');
    log('  Amounts and timing are public, and the payout to the new wallet is visible.');
    log('  One operator wallet funded the inventory, which links those addresses.');
    log("  The enclave's own RPC reads and quotes are visible to those providers.");
    log('  The anonymity set is very small here. This demonstrates hiding a link, not anonymity.');
    return result;
  } finally {
    for (const stop of stopFns) stop();
    await journal.close().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
    await returnEth();
  }
}

function bigintToString(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
