import { MarginOverview } from '@/components/trading/margin/margin-overview';
import { PositionsTable } from '@/components/trading/margin/positions-table';

export default function MarginOverviewPage() {
  return (
    <div className="space-y-6">
      <MarginOverview />
      <PositionsTable />
    </div>
  );
}
