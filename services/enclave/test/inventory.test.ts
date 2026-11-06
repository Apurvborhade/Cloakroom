import { spawn, type ChildProcess } from 'node:child_process';
import { NATIVE, type CustodyEOA } from '@cloakroom/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  http,
  pad,
  parseEther,
  publicActions,
  walletActions,
  type Address,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Inventory, type InventoryChain } from '../src/inventory.js';
import { DepositWatcher } from '../src/watcher.js';

const GAS_RESERVE = parseEther('0.01');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0 }) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions)
  .extend(walletActions);

/** Runtime bytecode that answers balanceOf(address) from the storage slot named by the address. */
const BALANCE_OF_BYTECODE = '0x6004355460005260206000f3';

let anvilProcess: ChildProcess;
let usdc: Address;

const freshAddress = () => privateKeyToAddress(generatePrivateKey());

async function fund(eoa: Address, native: bigint, tokenAmount = 0n): Promise<void> {
  await anvil.setBalance({ address: eoa, value: native });
  await anvil.setStorageAt({
    address: usdc,
    index: pad(eoa),
    value: pad(`0x${tokenAmount.toString(16)}`),
  });
  await anvil.mine({ blocks: 1 });
}

function setup(roles: Array<CustodyEOA['role']>, chainPort: InventoryChain = chain) {
  const eoas: CustodyEOA[] = roles.map((role, index) => ({
    index,
    address: freshAddress(),
    role,
    lastUsedAt: 0,
  }));
  const inventory = new Inventory({
    chain: chainPort,
    keys: { list: () => eoas },
    tokens: [usdc],
    gasReserveWei: GAS_RESERVE,
  });
  return { inventory, eoas, addresses: eoas.map((eoa) => eoa.address) };
}

const NO_EXCLUSIONS = new Set<Address>();

beforeAll(async () => {
  anvilProcess = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chain.getBlockNumber();
      usdc = freshAddress();
      await anvil.setCode({ address: usdc, bytecode: BALANCE_OF_BYTECODE });
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

describe('Inventory', () => {
  beforeEach(async () => {
    await anvil.mine({ blocks: 1 });
  });

  describe('pick', () => {
    it('finds nothing before the first refresh', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));

      expect(inventory.pick(NATIVE, parseEther('0.1'), NO_EXCLUSIONS)).toBeNull();
    });

    it('picks an inventory EOA with enough of the native token', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      expect(inventory.pick(NATIVE, parseEther('0.5'), NO_EXCLUSIONS)?.address).toBe(addresses[0]);
    });

    it('keeps the gas reserve when spending the native token', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      const mostItCanSpend = parseEther('1') - GAS_RESERVE;
      expect(inventory.pick(NATIVE, mostItCanSpend, NO_EXCLUSIONS)).not.toBeNull();
      expect(inventory.pick(NATIVE, mostItCanSpend + 1n, NO_EXCLUSIONS)).toBeNull();
    });

    it('reads ERC-20 balances and requires gas to send them', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory']);
      await fund(addresses[0]!, 0n, 5_000_000n);
      await fund(addresses[1]!, GAS_RESERVE, 5_000_000n);
      await inventory.refresh();

      expect(inventory.pick(usdc, 5_000_000n, NO_EXCLUSIONS)?.address).toBe(addresses[1]);
      expect(inventory.pick(usdc, 5_000_001n, NO_EXCLUSIONS)).toBeNull();
    });

    it('does not let one token cover another', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('100'));
      await inventory.refresh();

      expect(inventory.pick(usdc, 1n, NO_EXCLUSIONS)).toBeNull();
    });

    it('never picks an excluded EOA, even when it is the only funded one', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      expect(inventory.pick(NATIVE, 1n, new Set([addresses[0]!]))).toBeNull();
    });

    it('matches exclusions and tokens whatever the address case', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'), 10n);
      await inventory.refresh();

      const lower = addresses[0]!.toLowerCase() as Address;
      expect(inventory.pick(NATIVE, 1n, new Set([lower]))).toBeNull();
      expect(inventory.pick(usdc.toLowerCase() as Address, 1n, NO_EXCLUSIONS)).not.toBeNull();
    });

    it('never picks a deposit EOA', async () => {
      const { inventory, addresses } = setup(['deposit']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).toBeNull();
    });

    it('rotates to the least recently used EOA', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory', 'inventory']);
      for (const address of addresses) await fund(address, parseEther('1'));
      await inventory.refresh();

      const used: Address[] = [];
      for (let round = 0; round < 4; round++) {
        const chosen = inventory.pick(NATIVE, 1n, NO_EXCLUSIONS);
        used.push(chosen!.address);
        inventory.hold(chosen!.address, NATIVE, 1n, `op-${round}`);
        inventory.free(`op-${round}`);
      }

      expect(used).toEqual([addresses[0], addresses[1], addresses[2], addresses[0]]);
    });

    it('returns a copy, so callers cannot change internal state', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)!.role = 'deposit';

      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).not.toBeNull();
    });

    it('sees EOAs the key manager adds later', async () => {
      const { inventory, eoas } = setup([]);
      await inventory.refresh();
      const added = freshAddress();
      eoas.push({ index: 0, address: added, role: 'inventory', lastUsedAt: 0 });
      await fund(added, parseEther('1'));
      await inventory.refresh();

      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)?.address).toBe(added);
    });
  });

  describe('hold and free', () => {
    it('stops a held EOA being picked until it is freed', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      inventory.hold(addresses[0]!, NATIVE, parseEther('0.1'), 'op-1');
      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).toBeNull();

      inventory.free('op-1');
      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).not.toBeNull();
    });

    it('refuses a second operation on a busy EOA', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();
      inventory.hold(addresses[0]!, NATIVE, 1n, 'op-1');

      expect(() => inventory.hold(addresses[0]!, NATIVE, 1n, 'op-2')).toThrow('EOA_IN_FLIGHT');
    });

    it('refuses a duplicate operation ID', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await fund(addresses[1]!, parseEther('1'));
      await inventory.refresh();
      inventory.hold(addresses[0]!, NATIVE, 1n, 'op-1');

      expect(() => inventory.hold(addresses[1]!, NATIVE, 1n, 'op-1')).toThrow('DUPLICATE_OP');
    });

    it('refuses an unknown EOA, a deposit EOA, or an amount it cannot cover', async () => {
      const { inventory, addresses } = setup(['inventory', 'deposit']);
      await fund(addresses[0]!, parseEther('1'));
      await fund(addresses[1]!, parseEther('1'));
      await inventory.refresh();

      expect(() => inventory.hold(freshAddress(), NATIVE, 1n, 'a')).toThrow('UNKNOWN_EOA');
      expect(() => inventory.hold(addresses[1]!, NATIVE, 1n, 'b')).toThrow('NOT_INVENTORY');
      expect(() => inventory.hold(addresses[0]!, NATIVE, parseEther('1'), 'c')).toThrow(
        'NO_INVENTORY',
      );
    });

    it('does not leak addresses in error messages', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      let message = '';
      try {
        inventory.hold(addresses[0]!, NATIVE, parseEther('2'), 'op-1');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe('NO_INVENTORY');
    });

    it('leaves nothing held after a failed hold', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      expect(() => inventory.hold(addresses[0]!, NATIVE, parseEther('2'), 'op-1')).toThrow();
      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).not.toBeNull();
    });

    it('treats freeing twice or freeing an unknown operation as harmless', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();
      inventory.hold(addresses[0]!, NATIVE, 1n, 'op-1');
      inventory.free('op-1');

      expect(() => inventory.free('op-1')).not.toThrow();
      expect(() => inventory.free('never-held')).not.toThrow();
    });

    it('does not make spent funds available when refresh runs before free', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();
      inventory.hold(addresses[0]!, NATIVE, parseEther('0.9'), 'op-1');

      await anvil.setBalance({ address: addresses[0]!, value: parseEther('0.1') });
      await anvil.mine({ blocks: 1 });
      await inventory.refresh();
      inventory.free('op-1');

      expect(inventory.pick(NATIVE, parseEther('0.5'), NO_EXCLUSIONS)).toBeNull();
      expect(inventory.pick(NATIVE, parseEther('0.05'), NO_EXCLUSIONS)).not.toBeNull();
    });
  });

  describe('refresh', () => {
    it('does not let a slower, older refresh overwrite a newer one', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let readStarted!: () => void;
      const olderReadStarted = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      let calls = 0;
      const slowChain: InventoryChain = {
        getBlockNumber: chain.getBlockNumber,
        readContract: chain.readContract,
        getBalance: (async (args: Parameters<PublicClient['getBalance']>[0]) => {
          calls += 1;
          if (calls === 1) {
            readStarted();
            await gate;
          }
          return chain.getBalance(args);
        }) as PublicClient['getBalance'],
      };
      const { inventory, addresses } = setup(['inventory'], slowChain);

      const older = inventory.refresh();
      await olderReadStarted;
      // A real transaction, because anvil_setBalance also rewrites the latest block's stored state.
      const [sender] = await anvil.getAddresses();
      const hash = await anvil.sendTransaction({
        account: sender!,
        to: addresses[0]!,
        value: parseEther('1'),
        chain: foundry,
      });
      await anvil.waitForTransactionReceipt({ hash });
      await inventory.refresh();
      release();
      await older;

      expect(inventory.pick(NATIVE, parseEther('0.5'), NO_EXCLUSIONS)).not.toBeNull();
    });

    it('keeps the previous balances when a read fails', async () => {
      let failing = false;
      const flakyChain: InventoryChain = {
        getBlockNumber: chain.getBlockNumber,
        getBalance: chain.getBalance,
        readContract: (async (args: Parameters<PublicClient['readContract']>[0]) => {
          if (failing) throw new Error('rpc down');
          return chain.readContract(args);
        }) as PublicClient['readContract'],
      };
      const { inventory, addresses } = setup(['inventory'], flakyChain);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();

      failing = true;
      await expect(inventory.refresh()).rejects.toThrow('rpc down');
      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).not.toBeNull();
    });
  });

  describe('getPhysicalBalances', () => {
    it('sums per token, counts deposit EOAs in full, and leaves out inventory gas reserves', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory', 'deposit']);
      await fund(addresses[0]!, parseEther('1'), 100n);
      await fund(addresses[1]!, parseEther('2'), 200n);
      await fund(addresses[2]!, parseEther('3'));

      const totals = await inventory.getPhysicalBalances();

      expect(totals.get(NATIVE)).toBe(parseEther('6') - 2n * GAS_RESERVE);
      expect(totals.get(usdc)).toBe(300n);
    });

    it('does not go negative for an EOA below its gas reserve', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory']);
      await fund(addresses[0]!, GAS_RESERVE / 2n);
      await fund(addresses[1]!, parseEther('1'));

      const totals = await inventory.getPhysicalBalances();

      expect(totals.get(NATIVE)).toBe(parseEther('1') - GAS_RESERVE);
    });

    it('still counts funds while they are held, since they have not left the EOA', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();
      inventory.hold(addresses[0]!, NATIVE, parseEther('0.5'), 'op-1');

      const totals = await inventory.getPhysicalBalances();

      expect(totals.get(NATIVE)).toBe(parseEther('1') - GAS_RESERVE);
    });

    it('reports reads from the chain at call time', async () => {
      const { inventory, addresses } = setup(['inventory']);
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();
      await fund(addresses[0]!, parseEther('2'));

      const totals = await inventory.getPhysicalBalances();

      expect(totals.get(NATIVE)).toBe(parseEther('2') - GAS_RESERVE);
    });
  });

  describe('owner separation', () => {
    it('tracks each owner separately', () => {
      const { inventory } = setup([]);
      const alice = freshAddress();
      const bob = freshAddress();
      const eoa = freshAddress();

      inventory.linkOwner(alice, eoa);

      expect([...inventory.eoasLinkedTo(alice)]).toEqual([eoa]);
      expect(inventory.eoasLinkedTo(bob).size).toBe(0);
    });

    it('runs an owner from a different EOA than the one they funded', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory']);
      const alice = freshAddress();
      await fund(addresses[0]!, parseEther('1'));
      await fund(addresses[1]!, parseEther('1'));
      await inventory.refresh();
      inventory.linkOwner(alice, addresses[0]!);

      const chosen = inventory.pick(NATIVE, 1n, inventory.eoasLinkedTo(alice));

      expect(chosen?.address).toBe(addresses[1]);
    });

    it('rejects cleanly when the only funded EOA is linked to the owner', async () => {
      const { inventory, addresses } = setup(['inventory', 'inventory']);
      const alice = freshAddress();
      await fund(addresses[0]!, parseEther('1'));
      await inventory.refresh();
      inventory.linkOwner(alice, addresses[0]!);

      expect(inventory.pick(NATIVE, 1n, inventory.eoasLinkedTo(alice))).toBeNull();
    });
  });

  describe('replay', () => {
    it('rebuilds relabelled EOAs and owner links from the journal', async () => {
      const { inventory, addresses } = setup(['deposit', 'inventory']);
      const alice = freshAddress();
      await fund(addresses[0]!, parseEther('1'));
      await fund(addresses[1]!, parseEther('1'));

      inventory.replay({
        t: 'DEPOSIT_SESSION_OPENED',
        id: 's1',
        owner: alice,
        eoa: addresses[0]!,
        expiry: 1,
        baseline: 0n,
        baselineBlock: 0n,
      });
      inventory.replay({ t: 'DEPOSIT_SESSION_CLOSED', id: 's1', eoa: addresses[0]! });
      await inventory.refresh();

      expect(inventory.pick(NATIVE, 1n, new Set([addresses[1]!]))?.address).toBe(addresses[0]);
      expect([...inventory.eoasLinkedTo(alice)]).toEqual([addresses[0]]);
    });

    it('links an owner to the EOA that ran their swap', () => {
      const { inventory } = setup([]);
      const alice = freshAddress();
      const eoa = freshAddress();
      const hash = pad('0x1');

      inventory.replay({ t: 'EXEC_BROADCAST', opId: 'op-1', eoa, nonce: 0, txHash: hash, raw: '0x' });
      expect(inventory.eoasLinkedTo(alice).size).toBe(0);

      inventory.replay({
        t: 'EXEC_SETTLED',
        opId: 'op-1',
        intentId: 'i1',
        owner: alice,
        tokenOut: usdc,
        amountOut: 1n,
        fee: 0n,
      });
      expect([...inventory.eoasLinkedTo(alice)]).toEqual([eoa]);
    });

    it('ignores events that do not concern it', () => {
      const { inventory } = setup([]);

      expect(() =>
        inventory.replay({ t: 'NONCE_USED', owner: freshAddress(), nonce: 1n }),
      ).not.toThrow();
    });
  });

  describe('with the deposit watcher', () => {
    it('makes a deposit address pickable once its session closes', async () => {
      const { inventory, addresses } = setup(['deposit']);
      const eoa = addresses[0]!;
      const owner = freshAddress();
      const watcher = new DepositWatcher({
        chain,
        journal: { append: async () => {} },
        ledger: { credit: () => {} },
        queue: { run: (op) => op() },
        confirmations: 2n,
        onSessionClosed: (closed) => inventory.markInventory(closed),
      });
      const head = await chain.getBlock();
      await watcher.openSession({ id: 's1', owner, eoa, expiry: Number(head.timestamp) + 60 });
      inventory.linkOwner(owner, eoa);

      await fund(eoa, parseEther('1'));
      await anvil.mine({ blocks: 2 });
      await watcher.tick();
      await inventory.refresh();
      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)).toBeNull();

      await anvil.increaseTime({ seconds: 120 });
      await anvil.mine({ blocks: 3 });
      await watcher.tick();
      await inventory.refresh();

      expect(inventory.pick(NATIVE, 1n, NO_EXCLUSIONS)?.address).toBe(eoa);
      expect(inventory.pick(NATIVE, 1n, inventory.eoasLinkedTo(owner))).toBeNull();
    });
  });
});
