import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  http,
  parseEther,
  publicActions,
  walletActions,
  type Address,
} from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  DepositWatcher,
  type DepositEvent,
  type WatcherLedger,
  type WatcherQueue,
} from '../services/enclave/src/watcher.js';

const CONFIRMATIONS = 2n;
const NATIVE: Address = '0x0000000000000000000000000000000000000000';
const OWNER = privateKeyToAddress(generatePrivateKey());
const PORT = 20000 + Math.floor(Math.random() * 20000);
const RPC_URL = `http://127.0.0.1:${PORT}`;

const transport = http(RPC_URL);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0 });
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions)
  .extend(walletActions);

let anvilProcess: ChildProcess;
let senders: Address[];

const freshEoa = () => privateKeyToAddress(generatePrivateKey());

async function now(): Promise<number> {
  return Number((await chain.getBlock()).timestamp);
}

async function send(to: Address, value: bigint, from: Address = senders[0]!): Promise<void> {
  const hash = await anvil.sendTransaction({ account: from, to, value, chain: foundry });
  await anvil.waitForTransactionReceipt({ hash });
}

async function passTime(seconds: number): Promise<void> {
  await anvil.increaseTime({ seconds });
  await anvil.mine({ blocks: 1 });
}

function setup(onSessionClosed?: (eoa: Address) => void) {
  const journal: DepositEvent[] = [];
  const credits: Array<{ owner: Address; token: Address; amount: bigint; ref: string }> = [];
  const order: string[] = [];
  const queue: WatcherQueue = { run: (op) => op() };
  const ledger: WatcherLedger = {
    credit(owner, token, amount, ref) {
      order.push('ledger');
      credits.push({ owner, token, amount, ref });
    },
  };
  const journalPort = {
    append: async (event: DepositEvent) => {
      order.push(event.t);
      journal.push(event);
    },
  };
  const watcher = new DepositWatcher({
    chain,
    journal: journalPort,
    ledger,
    queue,
    confirmations: CONFIRMATIONS,
    onSessionClosed,
  });
  return { watcher, journal, journalPort, credits, order, ledger, queue };
}

const total = (credits: Array<{ amount: bigint }>) =>
  credits.reduce((sum, credit) => sum + credit.amount, 0n);

beforeAll(async () => {
  anvilProcess = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chain.getBlockNumber();
      senders = await anvil.getAddresses();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('anvil did not start');
}, 15_000);

afterAll(() => {
  anvilProcess?.kill();
});

describe('DepositWatcher', () => {
  let eoa: Address;

  beforeEach(async () => {
    eoa = freshEoa();
    await anvil.mine({ blocks: 3 });
  });

  it('credits a deposit only after CONFIRMATIONS blocks', async () => {
    const { watcher, credits } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });

    await send(eoa, parseEther('1'));
    await watcher.tick();
    expect(credits).toHaveLength(0);

    await anvil.mine({ blocks: 1 });
    await watcher.tick();
    expect(credits).toHaveLength(0);

    await anvil.mine({ blocks: 1 });
    await watcher.tick();
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ owner: OWNER, token: NATIVE, amount: parseEther('1') });
  });

  it('credits once however many times it checks', async () => {
    const { watcher, credits } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });

    await Promise.all([watcher.tick(), watcher.tick(), watcher.tick()]);
    await watcher.tick();
    await anvil.mine({ blocks: 3 });
    await watcher.tick();

    expect(total(credits)).toBe(parseEther('1'));
    expect(credits).toHaveLength(1);
  });

  it('credits each later deposit by its increase, from any sender', async () => {
    const { watcher, credits } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });

    await send(eoa, parseEther('1'), senders[0]);
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    await send(eoa, parseEther('0.5'), senders[1]);
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(credits.map((credit) => credit.amount)).toEqual([parseEther('1'), parseEther('0.5')]);
    expect(new Set(credits.map((credit) => credit.ref)).size).toBe(2);
  });

  it('does not credit a balance the EOA already held', async () => {
    await send(eoa, parseEther('2'));
    await anvil.mine({ blocks: 2 });

    const { watcher, credits } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(total(credits)).toBe(parseEther('1'));
  });

  it('ignores a falling balance', async () => {
    const { watcher, credits } = setup();
    await send(eoa, parseEther('2'));
    await anvil.mine({ blocks: 2 });
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });

    await anvil.setBalance({ address: eoa, value: parseEther('1') });
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(credits).toHaveLength(0);
  });

  it('does not credit a deposit made after expiry, and closes the session once', async () => {
    const closed: Address[] = [];
    const { watcher, credits, journal } = setup((address) => closed.push(address));
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 60 });

    await passTime(120);
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await watcher.tick();
    await watcher.tick();

    expect(credits).toHaveLength(0);
    expect(watcher.getSession('s1')?.open).toBe(false);
    expect(closed).toEqual([eoa]);
    expect(journal.filter((event) => event.t === 'DEPOSIT_SESSION_CLOSED')).toHaveLength(1);
  });

  it('credits a deposit mined before expiry but confirmed after it, and nothing later', async () => {
    const { watcher, credits } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 60 });

    await send(eoa, parseEther('1'));
    await passTime(120);
    await send(eoa, parseEther('5'));
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(total(credits)).toBe(parseEther('1'));
    expect(watcher.getSession('s1')?.open).toBe(false);
  });

  it('keeps a session open until a confirmed block is past expiry', async () => {
    const { watcher } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 60 });

    await passTime(120);
    await watcher.tick();

    expect(watcher.getSession('s1')?.open).toBe(true);
  });

  it('journals before crediting the ledger', async () => {
    const { watcher, order } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(order).toEqual(['DEPOSIT_SESSION_OPENED', 'DEPOSIT_CREDITED', 'ledger']);
  });

  it('journals everything replay needs in each event', async () => {
    const { watcher, journal } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 60 });
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await watcher.tick();
    await passTime(120);
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(journal.map((event) => event.t)).toEqual([
      'DEPOSIT_SESSION_OPENED',
      'DEPOSIT_CREDITED',
      'DEPOSIT_SESSION_CLOSED',
    ]);
    expect(journal[0]).toMatchObject({ id: 's1', owner: OWNER, eoa, baseline: 0n });
    expect(journal[1]).toMatchObject({ id: 's1', owner: OWNER, amount: parseEther('1') });
    expect(journal[2]).toEqual({ t: 'DEPOSIT_SESSION_CLOSED', id: 's1', eoa });
  });

  it('does not credit when the journal write fails, then retries', async () => {
    const { journalPort, credits, ledger, queue } = setup();
    let failing = false;
    const watcher = new DepositWatcher({
      chain,
      ledger,
      queue,
      confirmations: CONFIRMATIONS,
      journal: {
        append: async (event) => {
          if (failing) throw new Error('disk full');
          await journalPort.append(event);
        },
      },
    });
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });

    failing = true;
    await expect(watcher.tick()).rejects.toThrow('disk full');
    expect(credits).toHaveLength(0);

    failing = false;
    await watcher.tick();
    expect(total(credits)).toBe(parseEther('1'));
  });

  it('rebuilds from the journal without crediting again', async () => {
    const first = setup();
    await first.watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await first.watcher.tick();

    const second = setup();
    for (const event of first.journal) second.watcher.replay(event);
    expect(second.credits).toHaveLength(0);

    await anvil.mine({ blocks: 3 });
    await second.watcher.tick();
    expect(second.credits).toHaveLength(0);

    await send(eoa, parseEther('0.25'));
    await anvil.mine({ blocks: 2 });
    await second.watcher.tick();
    expect(total(second.credits)).toBe(parseEther('0.25'));
  });

  it('does not reopen a closed session on replay', async () => {
    const first = setup();
    await first.watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 60 });
    await passTime(120);
    await anvil.mine({ blocks: 2 });
    await first.watcher.tick();

    const second = setup();
    for (const event of first.journal) second.watcher.replay(event);
    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await second.watcher.tick();

    expect(second.credits).toHaveLength(0);
  });

  it('refuses a duplicate session or an EOA already in use', async () => {
    const { watcher } = setup();
    const expiry = (await now()) + 3600;
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry });

    await expect(
      watcher.openSession({ id: 's1', owner: OWNER, eoa: freshEoa(), expiry }),
    ).rejects.toThrow('DUPLICATE_SESSION');
    await expect(watcher.openSession({ id: 's2', owner: OWNER, eoa, expiry })).rejects.toThrow(
      'EOA_IN_USE',
    );
  });

  it('keeps separate sessions separate', async () => {
    const { watcher, credits } = setup();
    const other = freshEoa();
    const otherOwner = freshEoa();
    const expiry = (await now()) + 3600;
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry });
    await watcher.openSession({ id: 's2', owner: otherOwner, eoa: other, expiry });

    await send(eoa, parseEther('1'));
    await send(other, parseEther('3'));
    await anvil.mine({ blocks: 2 });
    await watcher.tick();

    expect(credits.find((credit) => credit.owner === OWNER)?.amount).toBe(parseEther('1'));
    expect(credits.find((credit) => credit.owner === otherOwner)?.amount).toBe(parseEther('3'));
  });

  it('checks on each new block once started', async () => {
    const { watcher, credits } = setup();
    await watcher.openSession({ id: 's1', owner: OWNER, eoa, expiry: (await now()) + 3600 });
    const client = createPublicClient({ chain: foundry, transport, pollingInterval: 50 });
    const errors: unknown[] = [];
    const stop = watcher.start(client, (error) => errors.push(error));

    await send(eoa, parseEther('1'));
    await anvil.mine({ blocks: 2 });
    await expect.poll(() => credits.length, { timeout: 5_000 }).toBe(1);

    stop();
    expect(errors).toEqual([]);
  });

  it('rejects replay of DEPOSIT_SESSION_OPENED with missing baseline', () => {
    const { watcher } = setup();
    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_SESSION_OPENED',
        id: 's-no-base',
        owner: OWNER,
        eoa,
        expiry: 1000,
        baselineBlock: 10n,
      } as any),
    ).toThrow(/baseline/);
  });

  it('rejects replay of DEPOSIT_SESSION_OPENED with missing baselineBlock', () => {
    const { watcher } = setup();
    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_SESSION_OPENED',
        id: 's-no-base-block',
        owner: OWNER,
        eoa,
        expiry: 1000,
        baseline: 0n,
      } as any),
    ).toThrow(/baselineBlock/);
  });

  it('rejects replay with missing owner on DEPOSIT_SESSION_OPENED and DEPOSIT_CREDITED', () => {
    const { watcher } = setup();
    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_SESSION_OPENED',
        id: 's-no-owner',
        eoa,
        expiry: 1000,
        baseline: 0n,
        baselineBlock: 10n,
      } as any),
    ).toThrow(/owner/);

    watcher.replay({
      t: 'DEPOSIT_SESSION_OPENED',
      id: 's-has-owner',
      owner: OWNER,
      eoa,
      expiry: 1000,
      baseline: 0n,
      baselineBlock: 10n,
    });

    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_CREDITED',
        id: 's-has-owner',
        amount: parseEther('1'),
        block: 15n,
      } as any),
    ).toThrow(/owner/);
  });

  it('valid deposit session survives watcher restart', async () => {
    const first = setup();
    const session = await first.watcher.openSession({
      id: 's-survive',
      owner: OWNER,
      eoa,
      expiry: (await now()) + 3600,
    });

    const second = setup();
    for (const event of first.journal) {
      second.watcher.replay(event);
    }

    const recovered = second.watcher.getSession('s-survive');
    expect(recovered).toBeDefined();
    expect(recovered?.id).toBe(session.id);
    expect(recovered?.owner).toBe(session.owner);
    expect(recovered?.eoa).toBe(session.eoa);
    expect(recovered?.baseline).toBe(session.baseline);
    expect(recovered?.lastCheckedBlock).toBe(session.baselineBlock);
    expect(recovered?.open).toBe(true);
  });

  it('watcher resumes from the original baseline block', async () => {
    const first = setup();
    const session = await first.watcher.openSession({
      id: 's-resume',
      owner: OWNER,
      eoa,
      expiry: (await now()) + 3600,
    });
    const originalBlock = session.baselineBlock;

    const second = setup();
    for (const event of first.journal) {
      second.watcher.replay(event);
    }
    const recovered = second.watcher.getSession('s-resume');
    expect(recovered?.lastCheckedBlock).toBe(originalBlock);

    // Send deposit and verify resumed watcher picks up from original baseline block
    await send(eoa, parseEther('2'));
    await anvil.mine({ blocks: 2 });
    await second.watcher.tick();

    expect(total(second.credits)).toBe(parseEther('2'));
    expect(second.credits[0]?.owner).toBe(OWNER);
  });

  it('replay reconstructs the correct owner and credited balance', async () => {
    const first = setup();
    await first.watcher.openSession({
      id: 's-recon',
      owner: OWNER,
      eoa,
      expiry: (await now()) + 3600,
    });
    await send(eoa, parseEther('1.25'));
    await anvil.mine({ blocks: 2 });
    await first.watcher.tick();

    expect(first.credits).toHaveLength(1);
    expect(first.credits[0]?.owner).toBe(OWNER);
    expect(first.credits[0]?.amount).toBe(parseEther('1.25'));

    // Replay journal into a new watcher
    const second = setup();
    for (const event of first.journal) {
      second.watcher.replay(event);
    }
    const restored = second.watcher.getSession('s-recon');
    expect(restored?.owner).toBe(OWNER);
    expect(restored?.credited).toBe(parseEther('1.25'));
    expect(restored?.open).toBe(true);
  });

  it('malformed historical events fail recovery rather than silently producing incorrect balances', () => {
    const { watcher } = setup();
    watcher.replay({
      t: 'DEPOSIT_SESSION_OPENED',
      id: 's-malformed',
      owner: OWNER,
      eoa,
      expiry: 1000,
      baseline: 0n,
      baselineBlock: 10n,
    });

    // Malformed amount (0n or negative)
    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_CREDITED',
        id: 's-malformed',
        owner: OWNER,
        amount: 0n,
        block: 15n,
      }),
    ).toThrow(/amount/);

    // Malformed owner (different from session owner)
    const imposter = freshEoa();
    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_CREDITED',
        id: 's-malformed',
        owner: imposter,
        amount: parseEther('1'),
        block: 15n,
      }),
    ).toThrow(/owner mismatch/i);

    // Malformed missing block
    expect(() =>
      watcher.replay({
        t: 'DEPOSIT_CREDITED',
        id: 's-malformed',
        owner: OWNER,
        amount: parseEther('1'),
      } as any),
    ).toThrow(/block/);
  });
});
