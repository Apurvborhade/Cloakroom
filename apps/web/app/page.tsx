import { PageHeader } from '@/components/layout/app-shell';
import { Dashboard } from '@/components/dashboard/dashboard';

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Private balances and conditional swaps, executed by an enclave from custody addresses. Amounts and timing stay public on-chain."
      />
      <Dashboard />
    </>
  );
}
