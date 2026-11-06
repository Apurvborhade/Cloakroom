import { PageHeader } from '@/components/layout/app-shell';
import { SwapPageContent } from '@/components/trading/swap-page';

export default function SwapPage() {
  return (
    <>
      <PageHeader title="Conditional swaps" description="Signed intents the enclave executes when its own price check reaches your trigger." />
      <SwapPageContent />
    </>
  );
}
