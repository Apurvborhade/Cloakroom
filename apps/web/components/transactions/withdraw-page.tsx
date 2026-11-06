'use client';

import { useState } from 'react';
import { BalancePanel } from '../dashboard/balance-panel';
import { RequireSession } from '../wallet/gates';
import { WithdrawFlow } from './withdraw-flow';
import { WithdrawalList } from './withdrawal-list';

export function WithdrawPageContent() {
  const [latest, setLatest] = useState<string | null>(null);
  return (
    <RequireSession purpose="withdraw">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <WithdrawFlow onCreated={setLatest} />
          <BalancePanel showActions={false} />
        </div>
        <WithdrawalList highlight={latest} />
      </div>
    </RequireSession>
  );
}
