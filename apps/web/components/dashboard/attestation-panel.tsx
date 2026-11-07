'use client';

import { useEnclave } from '@/hooks/use-enclave';
import { appConfig } from '@/lib/config';
import { describeError } from '@/lib/api/errors';
import { quoteByteLength } from '@/lib/attestation/enclave-identity';
import { formatDateTime } from '@/lib/format/time';
import { Address } from '../ui/address';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { CopyButton } from '../ui/copy-button';
import { KeyValue, KeyValueList, Unavailable } from '../ui/key-value';
import { Notice } from '../ui/notice';
import { Skeleton } from '../ui/skeleton';

export function AttestationPanel({ detailed = false }: { detailed?: boolean }) {
  const { identity, isLoading, error, refetch, isFetching } = useEnclave();
  const verifyCommand = appConfig.apiUrl
    ? `python3 scripts/verify-attestation.py --url ${appConfig.apiUrl}/attestation --measurements <trusted-measurements.json> --build-hash ${identity?.buildHash ?? '<build-hash>'}`
    : null;

  return (
    <Card>
      <CardHeader
        title="Enclave attestation"
        description="The key every request is encrypted to, and the signing domain it defines."
        action={<Button variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching}>Refresh</Button>}
      />
      <CardBody className="space-y-4">
        {isLoading && <Skeleton className="h-24" />}
        {error && <Notice tone="error" title="Enclave key unavailable">{describeError(error)}</Notice>}
        {identity && (
          <>
            {identity.mode === 'simulated' ? (
              <Notice tone="warn" title="TEE-simulated">
                The key came from <span className="font-mono">GET /sim/enclave-key</span>. It is not attested and there is no Nitro confidentiality: the operator can read every request.
                {identity.attestationFailure && <> /attestation answered {identity.attestationFailure}.</>}
              </Notice>
            ) : identity.mode === 'attested-verified' ? (
              <Notice tone="ok" title="Attestation verified in this browser">
                The quote's AWS signature, certificate chain, freshness, enclave key and PCR measurements all match the release pinned in this site's build. That pin comes from this site, so for an independent check, run the command below yourself.
              </Notice>
            ) : (
              <Notice tone="info" title="Attestation data received · not verified in this browser">
                The API returned a Nitro attestation document, but this app does not verify its signature, certificate chain or PCR measurements. Until you verify it yourself against trusted measurements, treat the key as unverified.
              </Notice>
            )}
            <KeyValueList>
              <KeyValue label="Status">
                {identity.mode === 'simulated' ? <Badge tone="warn" dot>Simulated</Badge> : identity.mode === 'attested-verified' ? <Badge tone="ok" dot>Verified</Badge> : <Badge tone="accent" dot>Received · unverified</Badge>}
              </KeyValue>
              <KeyValue label="Chain ID">{identity.chainId}</KeyValue>
              <KeyValue label="Enclave key (X25519)"><Address value={identity.enclavePubKey} head={10} tail={8} /></KeyValue>
              <KeyValue label="EIP-712 salt"><Address value={identity.salt} head={10} tail={8} /></KeyValue>
              <KeyValue label="Build hash">{identity.buildHash ? <Address value={identity.buildHash} head={10} tail={8} /> : <Unavailable />}</KeyValue>
              {detailed && (
                <>
                  <KeyValue label="Quote">
                    {identity.quote ? (
                      <span className="inline-flex items-center gap-2">~{quoteByteLength(identity.quote)?.toLocaleString()} bytes (COSE Sign1) <CopyButton value={identity.quote} label="Copy base64" /></span>
                    ) : <Unavailable />}
                  </KeyValue>
                  <KeyValue label="Freshness nonce">{identity.attestationNonce ? <Address value={identity.attestationNonce} head={10} tail={8} /> : <Unavailable />}</KeyValue>
                  <KeyValue label="Fetched">{formatDateTime(Math.floor(identity.fetchedAt / 1000))}</KeyValue>
                </>
              )}
            </KeyValueList>
            {detailed && identity.mode !== 'simulated' && verifyCommand && (
              <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
                <p className="text-xs font-medium text-fg-muted">Verify it yourself</p>
                <p className="mt-1 text-xs text-fg-subtle">
                  From a clone of the repository, check a fresh quote against the AWS Nitro root and measurements you trust (never PCRs taken from the quote). Then compare the key above with the verified one.
                </p>
                <div className="mt-2 flex items-start gap-2">
                  <code className="block flex-1 break-all rounded bg-ink-950 p-2 font-mono text-[11px] text-fg-muted">{verifyCommand}</code>
                  <CopyButton value={verifyCommand} />
                </div>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
