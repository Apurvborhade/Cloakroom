import { PageHeader } from '@/components/layout/app-shell';
import { WithdrawPageContent } from '@/components/transactions/withdraw-page';

export default function WithdrawPage() {
  return (
    <>
      <PageHeader title="Withdraw" description="Request a payout; follow it from locked to confirmed with the on-chain transaction." />
      <WithdrawPageContent />
    </>
  );
}
