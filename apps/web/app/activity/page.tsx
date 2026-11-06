import { PageHeader } from '@/components/layout/app-shell';
import { Dashboard } from '@/components/dashboard/dashboard';

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" description="Your account, balances, orders and withdrawals in detail." />
      <Dashboard />
    </>
  );
}
