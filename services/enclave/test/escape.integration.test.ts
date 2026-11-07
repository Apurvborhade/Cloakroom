import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ESCAPE_HATCH_ABI, NATIVE, escapeClaimId, type EscapeActivateMsg, type JournalEvent } from '@cloakroom/shared';
import {
  createPublicClient, createTestClient, encodeFunctionData, getAddress, http, keccak256,
  parseEther, publicActions, walletActions, type Address, type Hex, type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { EscapeHatchService, type EscapeDeps } from '../src/escape.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { KeyManager, type SigningPolicy } from '../src/keys.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey, type StateVault } from '../src/sealed-state.js';
import { SnapshotJournal } from '../src/snapshot-journal.js';
import { memoryJournal } from './helpers/memory-journal.js';

const artifact = JSON.parse(readFileSync(new URL('../../../contracts/out/EscapeHatch.sol/EscapeHatch.json', import.meta.url), 'utf8'));
const port = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${port}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 10 }) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport }).extend(publicActions).extend(walletActions);
const AMOUNT = parseEther('0.01');
let process: ChildProcess;
beforeAll(async () => {
  process = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { await chain.getBlockNumber(); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  throw new Error('Anvil required');
});
afterAll(() => { process?.kill(); });

async function setup(overrides: Partial<EscapeDeps> = {}) {
  const log = memoryJournal();
  const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey(randomBytes(32).toString('hex'), true), true);
  let failWrite: JournalEvent['t'] | undefined;
  const journal = { replay: log.journal.replay, async append(event: JournalEvent) {
    const entry = await log.journal.append(event);
    if (event.t === failWrite) { failWrite = undefined; throw new Error('ACK_LOST'); }
    return entry;
  } };
  const policy: SigningPolicy = { chainId: foundry.id, maxGas: 1_200_000n, maxFeePerGas: 100_000_000_000n,
    maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: parseEther('1') };
  let keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate: true });
  await keys.init();
  const [funder] = await anvil.getAddresses();
  const hash = await anvil.deployContract({ account: funder!, chain: foundry,
    abi: artifact.abi, bytecode: artifact.bytecode.object, args: [keys.escapeSignerAddress(), 60n] });
  const hatch = getAddress((await chain.waitForTransactionReceipt({ hash })).contractAddress!);
  policy.escapeHatch = hatch;
  keys = new KeyManager({ vault, journal, policy, simMode: true }); await keys.init();
  const owner = privateKeyToAccount(generatePrivateKey());
  await anvil.setBalance({ address: owner.address, value: parseEther('1') });
  await anvil.setBalance({ address: keys.escapeSignerAddress(), value: parseEther('1') });
  await anvil.setBalance({ address: hatch, value: parseEther('1') });
  let ledger = new InMemoryLedger();
  const append = async (event: JournalEvent) => { await journal.append(event); ledger.apply(event); };
  await append({ t: 'DEPOSIT_CREDITED', id: 'deposit', owner: owner.address, amount: AMOUNT, block: 1n });
  const code = `0x${randomBytes(32).toString('hex')}` as Hex;
  const message: EscapeActivateMsg = { owner: owner.address, hatch,
    claimId: escapeClaimId(foundry.id, hatch, owner.address, code), amount: AMOUNT, nonce: 1n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 120) };
  const errors = vi.fn();
  let service = new EscapeHatchService({ chain, chainId: foundry.id, hatch, keys, journal, ledger,
    queue: new FifoSerialQueue(), confirmations: 0n, receiptTimeoutMs: 50, gasMarginPercent: 120n, onError: errors, ...overrides });
  await service.init();
  return { owner, hatch, code, message, policy, journal, events: log.events, vault, errors, append,
    get keys() { return keys; }, get ledger() { return ledger; }, get service() { return service; },
    failNextWrite(type: JournalEvent['t']) { failWrite = type; },
    async restart(changes: Partial<EscapeDeps> = {}, stateVault: StateVault = vault) {
      keys.close(); keys = new KeyManager({ vault: stateVault, journal, policy, simMode: true }); await keys.init();
      ledger = await replayLedger(journal);
      service = new EscapeHatchService({ chain, chainId: foundry.id, hatch, keys, journal, ledger,
        queue: new FifoSerialQueue(), confirmations: 0n, receiptTimeoutMs: 50, gasMarginPercent: 120n, onError: errors, ...changes });
      await service.init();
    },
  };
}
async function registered(s: Awaited<ReturnType<typeof setup>>) {
  await s.service.activate(s.message, s.code);
  await vi.waitFor(() => expect(s.ledger.escape.owner(s.owner.address)?.status).toBe('registered'), { timeout: 3000, interval: 10 });
  await vi.waitFor(() => expect(s.keys.escapePending()).toBeUndefined(), { timeout: 3000, interval: 10 });
}
async function claim(s: Awaited<ReturnType<typeof setup>>) {
  await anvil.increaseTime({ seconds: 61 }); await anvil.mine({ blocks: 1 });
  const hash = await anvil.writeContract({ account: s.owner, chain: foundry, address: s.hatch,
    abi: ESCAPE_HATCH_ABI, functionName: 'claim', args: [s.code] });
  await chain.waitForTransactionReceipt({ hash });
}

describe('escape custody integration', () => {
  it('matches the contract claim-ID vector', () => {
    expect(escapeClaimId(11155111, '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222', `0x${'33'.repeat(32)}`))
      .toBe('0xcd55a817adf29b3f66bc70dabd43f0c9289462fa05aa797701f9ef31e0f05743');
  });

  it('locks the amount across restart and consumes it once after a direct contract claim', async () => {
    const s = await setup(); await registered(s);
    expect(s.ledger.getBalance(s.owner.address, NATIVE)).toMatchObject({ available: 0n, reserved: AMOUNT });
    expect(() => s.ledger.reserve(s.owner.address, NATIVE, 1n, 'withdraw')).toThrow('INSUFFICIENT_BALANCE');
    await s.restart();
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(AMOUNT);
    await claim(s); await s.service.tick(); await s.restart();
    expect(s.ledger.escape.owner(s.owner.address)?.status).toBe('claimed');
    expect(s.ledger.getBalance(s.owner.address, NATIVE)).toMatchObject({ available: 0n, reserved: 0n });
    expect(s.events.filter((event) => event.t === 'ESCAPE_CLAIMED')).toHaveLength(1);
  });

  it('rejects another owner copying a public claimId, before reserving anything', async () => {
    const s = await setup(); await registered(s);
    const owner = privateKeyToAccount(generatePrivateKey()).address;
    await s.append({ t: 'DEPOSIT_CREDITED', id: 'other', owner, amount: AMOUNT, block: 1n });
    await expect(s.service.activate({ ...s.message, owner }, s.code)).rejects.toThrow('INVALID_PAYLOAD');
    expect(s.ledger.getBalance(owner, NATIVE)).toMatchObject({ available: AMOUNT, reserved: 0n });
    await s.service.tick();
    expect(s.ledger.escape.all()).toHaveLength(1);
  });

  it.each(['intent', 'lending', 'deposit', 'reserved', 'token'] as const)('rejects ineligible %s state', async (kind) => {
    const s = await setup();
    if (kind === 'intent') {
      await s.journal.append({ t: 'INTENT_CREATED', id: 'old', owner: s.owner.address, intent: { owner: s.owner.address,
        tokenIn: NATIVE, tokenOut: s.hatch, amountIn: 1n, comparator: 0, triggerPrice: 1n,
        maxSlippageBps: 10, nonce: 0n, expiry: 1n } });
    } else if (kind === 'lending') {
      await s.journal.append({ t: 'MARGIN_SUPPLIED', opId: 'old', owner: s.owner.address, token: NATIVE, amount: 1n, nonce: 0n, expiry: 1n });
    } else if (kind === 'deposit') {
      await s.journal.append({ t: 'DEPOSIT_SESSION_OPENED', id: 'open', owner: s.owner.address, eoa: s.owner.address,
        baseline: 0n, baselineBlock: 1n, expiry: 4_000_000_000 });
    } else if (kind === 'reserved') s.ledger.reserve(s.owner.address, NATIVE, 1n, 'pending-withdrawal');
    else s.ledger.credit(s.owner.address, s.hatch, 1n, 'token');
    await expect(s.service.activate(s.message, s.code)).rejects.toThrow('ESCAPE_INELIGIBLE');
    expect(s.ledger.escape.all()).toHaveLength(0);
  });

  it('retains an unresolved signed registration and rebroadcasts identical bytes after restart', async () => {
    const send = vi.fn().mockRejectedValue(new Error('RPC_UNAVAILABLE'));
    const unavailable = { ...chain, sendRawTransaction: send, waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('TIMEOUT')) } as PublicClient;
    const s = await setup({ chain: unavailable });
    await s.service.activate(s.message, s.code);
    await vi.waitFor(() => expect(send).toHaveBeenCalled(), { interval: 10 });
    const pending = s.keys.escapePending()!;
    expect(pending.id).toBeDefined();
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(AMOUNT);
    await s.restart();
    expect(s.ledger.escape.owner(s.owner.address)).toMatchObject({ status: 'registered', raw: pending.raw });
    expect(await chain.getTransaction({ hash: keccak256(pending.raw) })).toMatchObject({ to: s.hatch.toLowerCase() });
  });

  it('recovers a signature persisted before the broadcast journal write', async () => {
    const s = await setup();
    const id = `escape:${s.owner.address}:1`;
    await s.append({ t: 'ESCAPE_RESERVED', id, owner: s.owner.address, hatch: s.hatch, claimId: s.message.claimId, amount: AMOUNT });
    const data = encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'registerClaim', args: [s.message.claimId, AMOUNT] });
    const raw = await s.keys.signEscape({ type: 'eip1559', chainId: foundry.id, nonce: 0,
      to: s.hatch, data, value: 0n, gas: 300_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }, id);
    expect(s.events.some((event) => event.t === 'ESCAPE_BROADCAST')).toBe(false);
    await s.restart();
    expect(s.ledger.escape.owner(s.owner.address)).toMatchObject({ status: 'registered', raw });
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(AMOUNT);
  });

  it.each(['sign', 'clear'] as const)('recovers a committed sealed cursor %s whose acknowledgement was lost', async (phase) => {
    const s = await setup();
    let fail = true;
    const vault: StateVault = { protection: s.vault.protection, read: () => s.vault.read(),
      async write(plaintext, revision) {
        const next = await s.vault.write(plaintext, revision);
        const pending = JSON.parse(Buffer.from(plaintext).toString('utf8')).escapePending;
        if (fail && (phase === 'sign' ? pending !== undefined : pending === undefined)) {
          fail = false; throw new Error('ACK_LOST');
        }
        return next;
      },
    };
    await s.restart({}, vault);
    await s.service.activate(s.message, s.code);
    await vi.waitFor(() => expect(s.errors).toHaveBeenCalled(), { interval: 10 });
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(AMOUNT);
    await s.restart();
    expect(s.ledger.escape.owner(s.owner.address)?.status).toBe('registered');
    expect(s.events.filter((event) => event.t === 'ESCAPE_REGISTERED')).toHaveLength(1);
    expect(s.keys.escapePending()).toBeUndefined();
  });

  it('never persists the emergency code or adds the escape signer to custody inventory', async () => {
    const s = await setup(); await registered(s);
    const journal = JSON.stringify(s.events, (_key, value) => typeof value === 'bigint' ? String(value) : value);
    expect(journal).not.toContain(s.code.slice(2));
    expect(Buffer.from((await s.vault.read())!.plaintext).toString('utf8')).not.toContain(s.code.slice(2));
    expect(s.keys.list().map((entry) => entry.address)).not.toContain(s.keys.escapeSignerAddress());
  });

  it('signs only the exact reserved claim with bounded fees and no value transfer', async () => {
    const s = await setup();
    const id = `escape:${s.owner.address}:1`;
    await s.append({ t: 'ESCAPE_RESERVED', id, owner: s.owner.address, hatch: s.hatch, claimId: s.message.claimId, amount: AMOUNT });
    const tx = { type: 'eip1559' as const, chainId: foundry.id, nonce: 0, to: s.hatch, value: 0n,
      data: encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'registerClaim', args: [s.message.claimId, AMOUNT] }),
      gas: 300_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
    for (const bad of [{ ...tx, to: s.owner.address }, { ...tx, value: 1n }, { ...tx, gas: 1_200_001n },
      { ...tx, chainId: 1 }, { ...tx, data: '0x1234' as Hex }, { ...tx, maxFeePerGas: 101_000_000_000n }]) {
      await expect(s.keys.signEscape(bad, id)).rejects.toThrow('SIGNING_DENIED');
    }
    await expect(s.keys.signEscape(tx, `${id}:missing`)).rejects.toThrow('SIGNING_DENIED');
    expect(s.keys.escapePending()).toBeUndefined();
    const raw = await s.keys.signEscape(tx, id);
    expect(s.keys.escapePending()).toMatchObject({ raw, nonce: 0, id });
    await expect(s.keys.signEscape(tx, id)).rejects.toThrow('SIGNING_DENIED');
  });

  it.each(['ESCAPE_RESERVED', 'ESCAPE_BROADCAST', 'ESCAPE_REGISTERED'] as const)('recovers a committed %s whose acknowledgement was lost', async (kind) => {
    const s = await setup(); s.failNextWrite(kind);
    if (kind === 'ESCAPE_RESERVED') await expect(s.service.activate(s.message, s.code)).rejects.toThrow('ESCAPE_JOURNAL_UNAVAILABLE');
    else {
      await s.service.activate(s.message, s.code);
      await vi.waitFor(() => expect(s.errors).toHaveBeenCalled(), { interval: 10 });
    }
    await s.restart();
    const expected = kind === 'ESCAPE_RESERVED' ? 'failed' : 'registered';
    expect(s.ledger.escape.owner(s.owner.address)?.status).toBe(expected);
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(kind === 'ESCAPE_RESERVED' ? 0n : AMOUNT);
  });

  it('releases a confirmed reverted registration when the reserve is insufficient', async () => {
    const s = await setup();
    // Estimate at a funded state, then remove the bond immediately before broadcast.
    const send = vi.spyOn(chain, 'sendRawTransaction').mockImplementationOnce(async ({ serializedTransaction }) => {
      await anvil.setBalance({ address: s.hatch, value: 0n });
      send.mockRestore();
      return chain.sendRawTransaction({ serializedTransaction });
    });
    await s.service.activate(s.message, s.code);
    await vi.waitFor(() => expect(s.ledger.escape.owner(s.owner.address)?.status).toBe('failed'), { interval: 10 });
    expect(s.ledger.getBalance(s.owner.address, NATIVE)).toMatchObject({ available: AMOUNT, reserved: 0n });
  });

  it('keeps heartbeat signing bounded and refuses renewals when custody is unhealthy', async () => {
    let healthy = true;
    const s = await setup({ healthy: () => healthy }); await registered(s);
    const length = s.events.length;
    await anvil.increaseTime({ seconds: 21 }); await anvil.mine({ blocks: 1 });
    await s.service.tick();
    expect(s.events).toHaveLength(length);
    expect(s.keys.escapePending()).toBeUndefined();
    const heartbeat = await chain.readContract({ address: s.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'lastHeartbeat' });
    healthy = false;
    await anvil.increaseTime({ seconds: 21 }); await anvil.mine({ blocks: 1 });
    await expect(s.service.tick()).rejects.toThrow('ESCAPE_UNAVAILABLE');
    expect(await chain.readContract({ address: s.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'lastHeartbeat' })).toBe(heartbeat);
  });

  it('recovers a pending heartbeat without releasing a registered claim', async () => {
    const s = await setup(); await registered(s);
    await anvil.increaseTime({ seconds: 21 }); await anvil.mine({ blocks: 1 });
    const data = encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'heartbeat' });
    const nonce = await chain.getTransactionCount({ address: s.keys.escapeSignerAddress() });
    const raw = await s.keys.signEscape({ type: 'eip1559', chainId: foundry.id, nonce,
      to: s.hatch, data, value: 0n, gas: 100_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    await s.restart();
    expect(await chain.getTransactionReceipt({ hash: keccak256(raw) })).toMatchObject({ status: 'success' });
    expect(s.keys.escapePending()).toBeUndefined();
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(AMOUNT);
  });

  it('stops heartbeats when the custody journal reaches its capacity', async () => {
    const s = await setup(); await registered(s);
    const journal = await SnapshotJournal.open({ store: new MemoryCipherBlobStore(), cipher: s.keys.journalCipher(),
      allowCreate: true, maxBytes: 8192, onFault: () => s.keys.close() });
    for (const event of s.events) await journal.append(event);
    await s.restart({ journal });
    const heartbeat = await chain.readContract({ address: s.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'lastHeartbeat' });
    await expect(journal.append({ t: 'DEPOSIT_SESSION_CLOSED', id: 'x'.repeat(8192), eoa: s.owner.address })).rejects.toThrow('JOURNAL_FULL');
    await anvil.increaseTime({ seconds: 21 }); await anvil.mine({ blocks: 1 });
    await expect(s.service.tick()).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    expect(await chain.readContract({ address: s.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'lastHeartbeat' })).toBe(heartbeat);
    expect(s.ledger.getBalance(s.owner.address, NATIVE).reserved).toBe(AMOUNT);
    await journal.close();
  });

  it('recovers a committed claim consumption without consuming twice', async () => {
    const s = await setup(); await registered(s); await claim(s);
    s.failNextWrite('ESCAPE_CLAIMED');
    await expect(s.service.tick()).rejects.toThrow('ESCAPE_JOURNAL_UNAVAILABLE');
    await s.restart();
    expect(s.ledger.getBalance(s.owner.address, NATIVE)).toMatchObject({ available: 0n, reserved: 0n });
    expect(s.events.filter((event) => event.t === 'ESCAPE_CLAIMED')).toHaveLength(1);
  });
});
