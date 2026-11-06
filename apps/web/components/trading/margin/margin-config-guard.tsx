'use client';

import type { ReactNode } from 'react';
import { appConfig } from '@/lib/config';
import { Notice } from '../../ui/notice';

export function MarginConfigGuard({ children }: { children: ReactNode }) {
  if (appConfig.marginUi === 'off') return <Notice tone="info" title="Margin UI is turned off">NEXT_PUBLIC_MARGIN_UI=off in this build.</Notice>;
  if (!appConfig.tokenOut) return <Notice tone="error" title="Margin needs the output token">Set NEXT_PUBLIC_TOKEN_OUT_ADDRESS: collateral is denominated in it.</Notice>;
  return <>{children}</>;
}
