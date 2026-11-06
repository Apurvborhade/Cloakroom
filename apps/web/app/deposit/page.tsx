import { PageHeader } from '@/components/layout/app-shell';
import { DepositFlow } from '@/components/transactions/deposit-flow';
import { BalancePanel } from '@/components/dashboard/balance-panel';
import { RequireEnclave, RequireWallet, SessionUnlock } from '@/components/wallet/gates';
import { SessionAware } from '@/components/wallet/session-aware';

export default function DepositPage() {
  return (
    <>
      <PageHeader title="Deposit" description="Fund your private balance with native ETH through a one-off custody address." />
      <RequireWallet purpose="deposit">
        <RequireEnclave>
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <DepositFlow />
            <SessionAware fallback={<SessionUnlock />}>
              <BalancePanel showActions={false} />
            </SessionAware>
          </div>
        </RequireEnclave>
      </RequireWallet>
    </>
  );
}
