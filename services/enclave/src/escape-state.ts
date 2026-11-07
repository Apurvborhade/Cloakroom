import { isDeepStrictEqual } from 'node:util';
import { NATIVE, type EscapeEvent } from '@cloakroom/shared';
import { getAddress, keccak256 } from 'viem';
import type { Address, Hex } from 'viem';
import type { InMemoryLedger } from './ledger.js';

type Approval = Extract<EscapeEvent, { t: 'ESCAPE_RESERVED' }>;
export interface EscapeRecord extends Omit<Approval, 't'> {
  status: 'reserved' | 'broadcast' | 'registered' | 'failed' | 'claimed';
  nonce?: number;
  txHash?: Hex;
  raw?: Hex;
  reason?: string;
}

export class EscapeState {
  private readonly records = new Map<string, EscapeRecord>();
  private readonly approvals = new Map<string, Approval>();
  private readonly owners = new Map<Address, string>();
  constructor(private readonly ledger: Pick<InMemoryLedger, 'reserve' | 'release' | 'consume'>) {}

  all(): EscapeRecord[] { return [...this.records.values()].map((record) => ({ ...record })); }
  get(id: string): EscapeRecord | undefined {
    const record = this.records.get(id);
    return record && { ...record };
  }
  owner(owner: Address): EscapeRecord | undefined {
    const id = this.owners.get(getAddress(owner));
    return id ? this.get(id) : undefined;
  }

  apply(event: EscapeEvent): void {
    if (event.t === 'ESCAPE_RESERVED') {
      const approval = this.approvals.get(event.id);
      if (approval) {
        if (!isDeepStrictEqual(approval, event)) throw new Error('ESCAPE_EVENT_CONFLICT');
        return;
      }
      const owner = getAddress(event.owner), previous = this.owner(owner);
      if (!event.id.startsWith('escape:') || typeof event.amount !== 'bigint' || event.amount <= 0n
          || !/^0x[a-fA-F0-9]{64}$/.test(event.claimId) || (previous && previous.status !== 'failed')
          || this.all().some((record) => record.claimId === event.claimId && record.status !== 'failed')) {
        throw new Error('ESCAPE_EVENT_CONFLICT');
      }
      getAddress(event.hatch);
      this.ledger.reserve(owner, NATIVE, event.amount, event.id);
      this.approvals.set(event.id, structuredClone(event));
      const { t: _type, ...fields } = event;
      this.records.set(event.id, { ...fields, owner, hatch: getAddress(event.hatch), status: 'reserved' });
      this.owners.set(owner, event.id);
      return;
    }
    const record = this.records.get(event.id);
    if (!record) throw new Error('ESCAPE_EVENT_CONFLICT');
    if (event.t === 'ESCAPE_BROADCAST') {
      if (record.status === 'broadcast' && record.txHash === event.txHash && record.raw === event.raw && record.nonce === event.nonce) return;
      if (record.status !== 'reserved' || !Number.isSafeInteger(event.nonce) || event.nonce < 0
          || keccak256(event.raw) !== event.txHash) throw new Error('ESCAPE_EVENT_CONFLICT');
      Object.assign(record, { nonce: event.nonce, txHash: event.txHash, raw: event.raw, status: 'broadcast' });
    } else if (event.t === 'ESCAPE_REGISTERED') {
      if (record.status === 'registered') return;
      if (record.status !== 'broadcast') throw new Error('ESCAPE_EVENT_CONFLICT');
      record.status = 'registered';
    } else if (event.t === 'ESCAPE_FAILED') {
      if (record.status === 'failed' && record.reason === event.reason) return;
      if (record.status !== 'reserved' && record.status !== 'broadcast') throw new Error('ESCAPE_EVENT_CONFLICT');
      this.ledger.release(event.id);
      record.status = 'failed'; record.reason = event.reason;
    } else {
      if (record.status === 'claimed') return;
      if (record.status !== 'registered') throw new Error('ESCAPE_EVENT_CONFLICT');
      this.ledger.consume(event.id);
      record.status = 'claimed';
    }
  }
}
