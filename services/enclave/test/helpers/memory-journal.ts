import type { Journal, JournalEntry, JournalEvent } from '@cloakroom/shared';

export function memoryJournal() {
  const events: JournalEvent[] = [];
  let refuse = false;
  const entries = (): JournalEntry[] => events.map((event, i) => ({
    sequence: i, timestamp: 0, prevHash: `0x${'00'.repeat(32)}`,
    entryHash: `0x${'00'.repeat(32)}`, event,
  }));
  const journal: Pick<Journal, 'append' | 'replay'> = {
    async append(event) {
      if (refuse) throw new Error('disk full');
      events.push(structuredClone(event));
      return entries().at(-1)!;
    },
    async *replay() { yield* entries(); },
  };
  return { events, journal, failWrites() { refuse = true; } };
}
