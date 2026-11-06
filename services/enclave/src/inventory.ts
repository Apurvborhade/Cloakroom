import { ERROR_CODES, NATIVE } from '@cloakroom/shared';
import type { CustodyEOA, InventoryReader, JournalEvent } from '@cloakroom/shared';
import { getAddress, parseAbi } from 'viem';
import type { Address, PublicClient } from 'viem';

const ERC20_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

/** The part of Felix's KeyManager that inventory uses. */
export interface CustodyEoaSource {
  list(): readonly CustodyEOA[];
}

export type InventoryChain = Pick<PublicClient, 'getBalance' | 'getBlockNumber' | 'readContract'>;

export interface InventoryDeps {
  chain: InventoryChain;
  keys: CustodyEoaSource;
  /** ERC-20 tokens to track. The native token is always tracked. */
  tokens: readonly Address[];
  /** Wei every inventory EOA keeps for gas. It is never spent or counted against claims. */
  gasReserveWei: bigint;
}

interface Hold {
  eoa: Address;
  token: Address;
  amount: bigint;
}

/**
 * Tracks what each custody EOA physically holds on-chain, and chooses which EOA runs an operation.
 *
 * Selection is what separates an owner's funded address from the address that executes for them,
 * so an EOA is only picked if the caller has not excluded it.
 *
 * An EOA runs one operation at a time. After an operation confirms, call refresh and then free,
 * in that order: freeing first would make the spent funds look available until the next refresh.
 */
export class Inventory implements InventoryReader {
  private readonly tokens: readonly Address[];
  private readonly eoas = new Map<Address, CustodyEOA>();
  private readonly relabelled = new Set<Address>();
  private readonly balances = new Map<Address, Map<Address, bigint>>();
  private readonly holds = new Map<string, Hold>();
  private readonly linkedEoas = new Map<Address, Set<Address>>();
  private readonly broadcastEoas = new Map<string, Address>();
  private appliedBlock = -1n;
  private useSequence = 0;

  constructor(private readonly deps: InventoryDeps) {
    this.tokens = deps.tokens.map((token) => getAddress(token));
  }

  /** Reads every balance at one block. A slower refresh never overwrites a newer one. */
  async refresh(): Promise<void> {
    this.syncEoas();
    const block = await this.deps.chain.getBlockNumber({ cacheTime: 0 });
    const addresses = [...this.eoas.keys()];
    const results = await Promise.all(addresses.map((eoa) => this.readBalances(eoa, block)));

    if (block < this.appliedBlock) return;
    this.appliedBlock = block;
    addresses.forEach((eoa, position) => {
      const result = results[position];
      if (result) this.balances.set(eoa, result);
    });
  }

  /**
   * Chooses the least recently used inventory EOA that can cover the amount and still keep its
   * gas reserve. Returns null when none can, which callers report as NO_INVENTORY.
   */
  pick(token: Address, amount: bigint, exclude: ReadonlySet<Address>): CustodyEOA | null {
    const excluded = new Set([...exclude].map((address) => getAddress(address)));
    const tokenAddress = getAddress(token);

    const candidates = [...this.eoas.values()]
      .filter((eoa) => eoa.role === 'inventory' && !eoa.inFlight && !excluded.has(eoa.address))
      .filter((eoa) => this.canCover(eoa.address, tokenAddress, amount))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.index - b.index);

    const chosen = candidates[0];
    return chosen ? { ...chosen } : null;
  }

  /** Sets funds aside for an operation and marks the EOA busy until free is called. */
  hold(eoa: Address, token: Address, amount: bigint, opId: string): void {
    const address = getAddress(eoa);
    const tokenAddress = getAddress(token);
    const custody = this.eoas.get(address);

    if (this.holds.has(opId)) throw new Error('DUPLICATE_OP');
    if (!custody) throw new Error('UNKNOWN_EOA');
    if (custody.role !== 'inventory') throw new Error('NOT_INVENTORY');
    if (custody.inFlight) throw new Error('EOA_IN_FLIGHT');
    if (!this.canCover(address, tokenAddress, amount)) throw new Error(ERROR_CODES.NO_INVENTORY);

    this.useSequence += 1;
    custody.inFlight = true;
    custody.lastUsedAt = this.useSequence;
    this.holds.set(opId, { eoa: address, token: tokenAddress, amount });
  }

  /**
   * Puts back the hold of an operation already broadcast before a restart. Unlike hold, this does
   * not check the balance, because the funds may have left once the transaction landed.
   */
  restoreHold(eoa: Address, token: Address, amount: bigint, opId: string): void {
    this.syncEoas();
    const address = getAddress(eoa);
    const custody = this.eoas.get(address);
    if (!custody) throw new Error('UNKNOWN_EOA');
    if (this.holds.has(opId)) return;

    custody.inFlight = true;
    this.holds.set(opId, { eoa: address, token: getAddress(token), amount });
  }

  /** Releases an operation's hold. Freeing an unknown or already freed operation does nothing. */
  free(opId: string): void {
    const hold = this.holds.get(opId);
    if (!hold) return;

    this.holds.delete(opId);
    const custody = this.eoas.get(hold.eoa);
    if (custody) custody.inFlight = false;
  }

  /** Makes a closed deposit address available to pick. Connect this to the watcher. */
  markInventory(eoa: Address): void {
    const address = getAddress(eoa);
    this.relabelled.add(address);
    const custody = this.eoas.get(address);
    if (custody) custody.role = 'inventory';
  }

  /** Records that an EOA received this owner's deposit or ran this owner's swap. */
  linkOwner(owner: Address, eoa: Address): void {
    const key = getAddress(owner);
    const linked = this.linkedEoas.get(key) ?? new Set<Address>();
    linked.add(getAddress(eoa));
    this.linkedEoas.set(key, linked);
  }

  /** The EOAs to pass to pick as `exclude` when operating for this owner. */
  eoasLinkedTo(owner: Address): ReadonlySet<Address> {
    return new Set(this.linkedEoas.get(getAddress(owner)));
  }

  /** Rebuilds roles and owner links from one journal event on boot. */
  replay(event: JournalEvent): void {
    switch (event.t) {
      case 'DEPOSIT_SESSION_OPENED':
        this.linkOwner(event.owner, event.eoa);
        break;
      case 'DEPOSIT_SESSION_CLOSED':
        this.markInventory(event.eoa);
        break;
      case 'EXEC_BROADCAST':
        this.broadcastEoas.set(event.opId, getAddress(event.eoa));
        break;
      case 'EXEC_SETTLED':
      case 'EXEC_FAILED': {
        const eoa = this.broadcastEoas.get(event.opId);
        if (eoa) this.linkOwner(event.owner, eoa);
        break;
      }
      default:
        break;
    }
  }

  /**
   * Per-token balances across all custody EOAs that can back claims, for reconcile.
   * Deposit EOAs count, because their funds are credited before the session closes.
   * The gas reserve of inventory EOAs does not count.
   */
  async getPhysicalBalances(): Promise<Map<Address, bigint>> {
    await this.refresh();

    const totals = new Map<Address, bigint>([[NATIVE, 0n]]);
    for (const token of this.tokens) totals.set(token, 0n);

    for (const eoa of this.eoas.values()) {
      for (const [token, amount] of totals) {
        const balance = this.physicalBalance(eoa.address, token);
        const reserve = token === NATIVE && eoa.role === 'inventory' ? this.deps.gasReserveWei : 0n;
        const spendable = balance > reserve ? balance - reserve : 0n;
        totals.set(token, amount + spendable);
      }
    }
    return totals;
  }

  private syncEoas(): void {
    for (const eoa of this.deps.keys.list()) {
      const address = getAddress(eoa.address);
      if (this.eoas.has(address)) continue;
      this.eoas.set(address, {
        ...eoa,
        address,
        role: this.relabelled.has(address) ? 'inventory' : eoa.role,
        inFlight: false,
      });
    }
  }

  private async readBalances(eoa: Address, blockNumber: bigint): Promise<Map<Address, bigint>> {
    const native = await this.deps.chain.getBalance({ address: eoa, blockNumber });
    const tokens = await Promise.all(
      this.tokens.map(async (token): Promise<[Address, bigint]> => {
        const balance = await this.deps.chain.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [eoa],
          blockNumber,
        });
        return [token, balance];
      }),
    );
    return new Map<Address, bigint>([[NATIVE, native], ...tokens]);
  }

  private canCover(eoa: Address, token: Address, amount: bigint): boolean {
    const freeNative = this.freeBalance(eoa, NATIVE);
    if (token === NATIVE) return freeNative >= amount + this.deps.gasReserveWei;
    return freeNative >= this.deps.gasReserveWei && this.freeBalance(eoa, token) >= amount;
  }

  private freeBalance(eoa: Address, token: Address): bigint {
    let free = this.physicalBalance(eoa, token);
    for (const hold of this.holds.values()) {
      if (hold.eoa === eoa && hold.token === token) free -= hold.amount;
    }
    return free;
  }

  private physicalBalance(eoa: Address, token: Address): bigint {
    return this.balances.get(eoa)?.get(token) ?? 0n;
  }
}
