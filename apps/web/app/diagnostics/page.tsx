import { PageHeader } from '@/components/layout/app-shell';
import { DiagnosticsPanel } from '@/components/diagnostics/diagnostics-panel';

export default function DiagnosticsPage() {
  return (
    <>
      <PageHeader title="Diagnostics" description="Connectivity, keys, sessions and chain-read routing, for testing the full product. Shows codes and timestamps only, never private contents." />
      <DiagnosticsPanel />
    </>
  );
}
