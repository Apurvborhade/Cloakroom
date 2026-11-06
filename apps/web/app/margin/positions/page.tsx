import { MarginGate } from '@/components/trading/margin/margin-gate';
import { PositionsTable } from '@/components/trading/margin/positions-table';

export default function MarginPositionsPage() {
  return (
    <MarginGate>
      <PositionsTable />
    </MarginGate>
  );
}
