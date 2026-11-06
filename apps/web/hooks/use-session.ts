'use client';

import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { sessionStore } from '@/lib/session/session-store';
import { useEnclave } from './use-enclave';
import { useOwner } from './use-owner';
import { useOwnerSigner } from './use-owner-signer';

/** The read session for the connected owner and current enclave key. */
export function useSession() {
  const snapshot = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, () => null);
  const { owner, ready } = useOwner();
  const { binding } = useEnclave();
  const signer = useOwnerSigner();
  // Re-evaluate expiry once per second-ish without re-rendering the whole tree too often.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(() => setTick((value) => value + 1), 5_000);
    return () => clearInterval(timer);
  }, [snapshot]);

  void tick;
  const active = Boolean(snapshot) && sessionStore.isActive(owner, binding);

  const unlock = useMutation({
    mutationKey: ['session', 'unlock'],
    mutationFn: async () => {
      if (!owner || !binding || !ready) throw new Error('NOT_READY');
      return sessionStore.establish({ owner, binding, ownerSigner: signer, api });
    },
  });

  const end = useCallback(() => sessionStore.end('manual'), []);

  return {
    session: active ? snapshot : null,
    active,
    lastEndReason: sessionStore.lastEndReason,
    unlock,
    end,
    canUnlock: Boolean(owner && binding && ready),
  };
}
