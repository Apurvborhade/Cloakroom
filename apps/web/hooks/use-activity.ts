'use client';

import { useSyncExternalStore } from 'react';
import { activityStore } from '@/lib/state/activity';

export function useActivity() {
  return useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getSnapshot);
}
