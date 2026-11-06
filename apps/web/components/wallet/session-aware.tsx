'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/hooks/use-session';

export function SessionAware({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { active } = useSession();
  return <>{active ? children : fallback}</>;
}
