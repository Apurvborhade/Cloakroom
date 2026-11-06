import { OpenPositionForm } from '@/components/trading/margin/open-position-form';
import { MarginOverview } from '@/components/trading/margin/margin-overview';

export default function MarginTradePage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <OpenPositionForm />
      <MarginOverview compact />
    </div>
  );
}
