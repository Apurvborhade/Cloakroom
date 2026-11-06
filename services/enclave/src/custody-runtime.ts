import type { Journal } from '@cloakroom/shared';
import { AttestationService } from './attestation.js';
import type { QuoteProvider } from './attestation.js';
import { KeyManager } from './keys.js';
import type { SigningPolicy } from './keys.js';
import { replayLedger } from './ledger.js';
import type { CipherBlobStore, StateVault } from './sealed-state.js';
import { SnapshotJournal } from './snapshot-journal.js';

export async function openCustodyRuntime(options: {
  vault: StateVault; journalStore: CipherBlobStore; policy: SigningPolicy; buildHash: string;
  allowCreate?: boolean; simMode?: boolean; quote?: QuoteProvider;
}) {
  const [state, snapshot] = await Promise.all([options.vault.read(), options.journalStore.read()]);
  const fresh = state === undefined && snapshot === undefined;
  if ((!state || snapshot === undefined) && !(fresh && options.allowCreate === true)) {
    throw new Error('CUSTODY_STATE_MISSING');
  }
  let journal: SnapshotJournal | undefined;
  const deferred: Pick<Journal, 'append' | 'replay'> = {
    append(event) {
      if (!journal) throw new Error('JOURNAL_NOT_OPEN');
      return journal.append(event);
    },
    async *replay() {
      if (!journal) throw new Error('JOURNAL_NOT_OPEN');
      yield* journal.replay();
    },
  };
  const keys = new KeyManager({ vault: options.vault, journal: deferred, policy: options.policy,
    simMode: options.simMode, allowCreate: fresh && options.allowCreate === true,
    onFault: () => { void journal?.close(); } });
  try {
    await keys.init();
    journal = await SnapshotJournal.open({ store: options.journalStore, cipher: keys.journalCipher(),
      allowCreate: fresh && options.allowCreate === true, onFault: () => keys.close() });
    const ledger = await replayLedger(journal);
    await keys.restoreSigningState();
    const attestation = new AttestationService(options.buildHash, {
      identity: keys, chainId: options.policy.chainId, provider: options.quote,
    });
    await attestation.response();
    const opened = journal;
    return { keys, journal: opened, ledger, attestation,
      async close() { keys.close(); await opened.close(); } };
  } catch (error) {
    keys.close();
    await journal?.close();
    throw error;
  }
}
