import { PageHeader } from '@/components/layout/app-shell';
import { AttestationPanel } from '@/components/dashboard/attestation-panel';
import { TrustModel } from '@/components/dashboard/trust-model';

export default function AttestationPage() {
  return (
    <>
      <PageHeader title="Attestation and trust" description="What the enclave proves, what this browser checks, and what you are trusting." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <AttestationPanel detailed />
        <TrustModel />
      </div>
    </>
  );
}
