import { randomBytes } from 'node:crypto';
import { NATIVE, type IntentMsg, type JournalEvent } from '@cloakroom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters,
  recoverTransactionAddress, type Address, type Hex, type TransactionSerializableEIP1559,
  type TransactionSerializedEIP1559 } from 'viem';
import { KeyManager, type SigningPolicy } from '../src/keys.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { memoryJournal } from './helpers/memory-journal.js';

const OWNER: Address = '0x1111111111111111111111111111111111111111';
const ROUTER: Address = '0x2222222222222222222222222222222222222222';
const TOKEN: Address = '0x3333333333333333333333333333333333333333';
const OTHER: Address = '0x4444444444444444444444444444444444444444';
const THIS: Address = '0x0000000000000000000000000000000000000002';
const AMOUNT = 10n ** 17n;
const NET = 300_000_000n;
const FLOOR = 300_300_301n;
const OP = 'exec:order';
const POLICY: SigningPolicy = { chainId: 11155111, maxGas: 1_200_000n,
  maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: 10n ** 18n,
  swaps: { routerAddress: ROUTER, tokenOut: TOKEN, tokenOutDecimals: 6, feeBps: 10 } };
const ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const now = () => BigInt(Math.floor(Date.now() / 1000));

function calldata(eoa: Address, minimum = FLOOR, options: { deadline?: bigint; token?: Address; direct?: bigint[] } = {}): Hex {
  const wrap = encodeAbiParameters(parseAbiParameters('address, uint256'), [THIS, AMOUNT]);
  const swap = (recipient: Address, min: bigint) => encodeAbiParameters(
    parseAbiParameters('address, uint256, uint256, address[], bool'),
    [recipient, AMOUNT, min, [OTHER, options.token ?? TOKEN], false]);
  const sweep = encodeAbiParameters(parseAbiParameters('address, address, uint256'),
    [options.token ?? TOKEN, eoa, minimum]);
  return encodeFunctionData({ abi: ABI, functionName: 'execute', args: [
    options.direct ? `0x0b${'08'.repeat(options.direct.length)}` : '0x0b0804',
    options.direct ? [wrap, ...options.direct.map((min) => swap(eoa, min))] : [wrap, swap(THIS, 0n), sweep],
    options.deadline ?? now() + 120n,
  ] });
}

async function setup(patch: Partial<IntentMsg> = {}, policy = POLICY) {
  const log = memoryJournal();
  const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey(randomBytes(32).toString('hex'), true), true);
  const options = { vault, journal: log.journal, policy, simMode: true, allowCreate: true };
  const keys = new KeyManager(options);
  await keys.init();
  const eoa = (await keys.allocate('inventory')).address;
  const intent: IntentMsg = { owner: OWNER, tokenIn: NATIVE, tokenOut: TOKEN, amountIn: AMOUNT,
    comparator: 0, triggerPrice: 3_000n * 10n ** 18n, maxSlippageBps: 50, nonce: 1n,
    expiry: now() + 300n, ...patch };
  await log.journal.append({ t: 'DEPOSIT_CREDITED', id: 'funding', owner: OWNER, amount: AMOUNT, block: 1n });
  await log.journal.append({ t: 'INTENT_CREATED', id: 'order', owner: OWNER, intent });
  const data = calldata(eoa);
  const expected = { eoa, to: ROUTER, value: AMOUNT, dataHash: keccak256(data), data };
  const tx: TransactionSerializableEIP1559 = { type: 'eip1559', chainId: POLICY.chainId, nonce: 0,
    to: ROUTER, value: AMOUNT, data, gas: 500_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  return { keys, options, eoa, intent, expected, tx, ...log };
}

afterEach(() => vi.restoreAllMocks());

describe('KeyManager swap authorization', () => {
  it('signs a journaled limit order and recovers exactly the same bytes after restart', async () => {
    const { keys, eoa, expected, tx, options, events } = await setup();
    await keys.registerOp(OP, expected);
    const raw = await keys.sign(eoa, tx, OP);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerializedEIP1559 })).toBe(eoa);
    expect(events.find((event) => event.t === 'SIGNING_REGISTERED')).toMatchObject({ data: expected.data });
    const restored = new KeyManager({ ...options, allowCreate: false });
    await restored.init();
    expect(await restored.recoverSigned(OP)).toBe(raw);
    await expect(restored.sign(eoa, tx, OP)).rejects.toThrow('SIGNING_DENIED');
    await expect(restored.registerOp(OP, expected)).rejects.toThrow('SIGNING_DENIED');
  });

  it('restores a registration before its first signature', async () => {
    const { keys, eoa, expected, tx, options } = await setup();
    await keys.registerOp(OP, expected);
    const restored = new KeyManager({ ...options, allowCreate: false });
    await restored.init();
    expect(await restored.sign(eoa, tx, OP)).toMatch(/^0x02/);
  });

  it('requires explicit swap policy, a unique intent, and the exact operation ID', async () => {
    const disabled = await setup({}, { ...POLICY, swaps: undefined });
    await expect(disabled.keys.registerOp(OP, disabled.expected)).rejects.toThrow('SIGNING_DENIED');
    const { keys, journal, expected, intent } = await setup();
    await expect(keys.registerOp('exec:missing', expected)).rejects.toThrow('SIGNING_DENIED');
    await expect(keys.registerOp('order', expected)).rejects.toThrow('SIGNING_DENIED');
    await journal.append({ t: 'INTENT_CREATED', id: 'order', owner: OWNER, intent });
    await expect(keys.registerOp(OP, expected)).rejects.toThrow('SIGNING_DENIED');
  });

  it.each([
    { comparator: 1 }, { owner: OTHER }, { tokenIn: TOKEN }, { tokenOut: OTHER },
    { amountIn: 0n }, { amountIn: AMOUNT + 1n }, { triggerPrice: 0n }, { expiry: 1n },
  ])('refuses incompatible journaled terms %s', async (patch) => {
    const { keys, expected } = await setup(patch);
    await expect(keys.registerOp(OP, expected)).rejects.toThrow('SIGNING_DENIED');
  });

  it('requires full calldata with its matching hash, router, amount and custody signer', async () => {
    const { keys, expected } = await setup();
    for (const patch of [{ data: undefined }, { data: '0x' as Hex }, { to: OTHER },
      { value: AMOUNT - 1n }, { eoa: OTHER }, { dataHash: keccak256('0x') }]) {
      await expect(keys.registerOp(OP, { ...expected, ...patch })).rejects.toThrow('SIGNING_DENIED');
    }
  });

  it('enforces the net limit without subtracting slippage, including split-route rounding', async () => {
    const { keys, expected, eoa } = await setup({ maxSlippageBps: 10_000 });
    for (const data of [calldata(eoa, NET), calldata(eoa, FLOOR - 1n),
      calldata(eoa, FLOOR, { direct: [150_150_150n, 150_150_150n] })]) {
      await expect(keys.registerOp(OP, { ...expected, data, dataHash: keccak256(data) })).rejects.toThrow('SIGNING_DENIED');
    }
    const data = calldata(eoa, FLOOR, { direct: [150_150_150n, 150_150_151n] });
    await expect(keys.registerOp(OP, { ...expected, data, dataHash: keccak256(data) })).resolves.toBeUndefined();
  });

  it('independently refuses redirected output, wrong tokens, expired calldata and unknown commands', async () => {
    const { keys, eoa, expected } = await setup();
    for (const data of [calldata(OTHER), calldata(eoa, FLOOR, { token: OTHER }),
      calldata(eoa, FLOOR, { deadline: now() }),
      encodeFunctionData({ abi: ABI, functionName: 'execute', args: ['0x80', ['0x'], now() + 60n] })]) {
      await expect(keys.registerOp(OP, { ...expected, data, dataHash: keccak256(data) })).rejects.toThrow('SIGNING_DENIED');
    }
  });

  const terminalEvents: JournalEvent[] = [
    { t: 'INTENT_CANCELLED', id: 'order', owner: OWNER },
    { t: 'INTENT_EXPIRED', id: 'order', owner: OWNER },
    { t: 'EXEC_BROADCAST', opId: OP, intentId: 'order', eoa: OTHER, nonce: 0, txHash: keccak256('0x'), raw: '0x' },
    { t: 'EXEC_SETTLED', opId: OP, intentId: 'order', owner: OWNER, tokenOut: TOKEN, amountOut: FLOOR, fee: 1n },
    { t: 'EXEC_FAILED', opId: OP, intentId: 'order', owner: OWNER, reason: 'test' },
  ];
  it.each(terminalEvents)('refuses $t before registration and after registration', async (event) => {
    const { keys, journal, expected, tx, eoa } = await setup();
    await keys.registerOp(OP, expected);
    await journal.append(event);
    await expect(keys.registerOp(OP, expected)).rejects.toThrow('SIGNING_DENIED');
    await expect(keys.sign(eoa, tx, OP)).rejects.toThrow('SIGNING_DENIED');
  });

  it('checks expiry again when signing, even without an expiration event', async () => {
    const { keys, eoa, expected, tx, intent } = await setup();
    await keys.registerOp(OP, expected);
    vi.spyOn(Date, 'now').mockReturnValue(Number(intent.expiry) * 1000);
    await expect(keys.sign(eoa, tx, OP)).rejects.toThrow('SIGNING_DENIED');
  });

  it('checks the router deadline again when signing', async () => {
    const { keys, eoa, expected, tx } = await setup();
    const deadline = now() + 5n;
    const data = calldata(eoa, FLOOR, { deadline });
    await keys.registerOp(OP, { ...expected, data, dataHash: keccak256(data) });
    vi.spyOn(Date, 'now').mockReturnValue(Number(deadline) * 1000);
    await expect(keys.sign(eoa, { ...tx, data }, OP)).rejects.toThrow('SIGNING_DENIED');
  });

  it('binds signing to the registered calldata even if replacement calldata also clears the floor', async () => {
    const { keys, eoa, expected, tx } = await setup();
    await keys.registerOp(OP, expected);
    const data = calldata(eoa, FLOOR + 100n);
    await expect(keys.registerOp(OP, { ...expected, data, dataHash: keccak256(data) })).rejects.toThrow('SIGNING_DENIED');
    await expect(keys.sign(eoa, { ...tx, data }, OP)).rejects.toThrow('SIGNING_DENIED');
  });

  it('refuses deposit addresses belonging to the order owner, even after deposit closure', async () => {
    const { keys, journal, expected, eoa } = await setup();
    await journal.append({ t: 'DEPOSIT_SESSION_OPENED', id: 'deposit', owner: OWNER, eoa,
      expiry: Number(now() + 30n), baseline: 0n, baselineBlock: 0n });
    await journal.append({ t: 'DEPOSIT_SESSION_CLOSED', id: 'deposit', eoa });
    await expect(keys.registerOp(OP, expected)).rejects.toThrow('SIGNING_DENIED');
  });

  it.each([OWNER, OTHER])('reconstructs prior swap links to %s, including unfinished swaps', async (owner) => {
    const { keys, journal, expected, eoa, intent } = await setup();
    await journal.append({ t: 'INTENT_CREATED', id: 'earlier', owner, intent: { ...intent, owner } });
    await journal.append({ t: 'EXEC_BROADCAST', opId: 'exec:earlier', eoa, nonce: 0, txHash: keccak256('0x'), raw: '0x' });
    if (owner === OWNER) await expect(keys.registerOp(OP, expected)).rejects.toThrow('SIGNING_DENIED');
    else await expect(keys.registerOp(OP, expected)).resolves.toBeUndefined();
  });

  it('freezes swap configuration and refuses invalid decimals or fees', async () => {
    const policy = { ...POLICY, swaps: { ...POLICY.swaps! } };
    const { keys, options, expected } = await setup({}, policy);
    policy.swaps.routerAddress = OTHER;
    await expect(keys.registerOp(OP, expected)).resolves.toBeUndefined();
    for (const patch of [{ tokenOutDecimals: -1 }, { tokenOutDecimals: 256 }, { tokenOutDecimals: 1.5 },
      { feeBps: -1 }, { feeBps: 10_000 }]) {
      expect(() => new KeyManager({ ...options, policy: { ...POLICY, swaps: { ...POLICY.swaps!, ...patch } } }))
        .toThrow('INVALID_SIGNING_POLICY');
    }
  });
});
