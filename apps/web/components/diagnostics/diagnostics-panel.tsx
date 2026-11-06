'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDisconnect } from 'wagmi';
import { useChainReadStatus } from '@/hooks/use-chain-reader';
import { ENCLAVE_QUERY_KEY, useEnclave } from '@/hooks/use-enclave';
import { useMarginAvailability } from '@/hooks/use-private-data';
import { PRIVATE_QUERY_ROOT } from '@/hooks/use-private-read';
import { useOwner } from '@/hooks/use-owner';
import { useSession } from '@/hooks/use-session';
import { describeError } from '@/lib/api/errors';
import { BROWSER_READS, BYPASSING_TRAFFIC, chainReader } from '@/lib/chain';
import { appConfig } from '@/lib/config';
import { hpkeSelfTest } from '@/lib/crypto/self-test';
import { diagnosticsStore } from '@/lib/state/diagnostics';
import { formatClock } from '@/lib/format/time';
import { Address } from '../ui/address';
import { Badge } from '../ui/badge';
import type { Tone } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Countdown } from '../ui/countdown';
import { Notice } from '../ui/notice';

function Row({ label, status, tone = 'neutral', children }: { label: string; status?: string; tone?: Tone; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-sm text-fg-subtle">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg sm:justify-end sm:text-right">
        {status && <Badge tone={tone} dot>{status}</Badge>}
        {children}
      </dd>
    </div>
  );
}

const ms = (value: number | null) => (value ? formatClock(Math.floor(value / 1000)) : 'never');

export function DiagnosticsPanel() {
  const queryClient = useQueryClient();
  const diagnostics = useSyncExternalStore(diagnosticsStore.subscribe, diagnosticsStore.getSnapshot, diagnosticsStore.getSnapshot);
  const { owner, isConnected, walletChainId, wrongChain, connectorName } = useOwner();
  const { identity, error: enclaveError, isFetching: enclaveFetching } = useEnclave();
  const { session, unlock, canUnlock } = useSession();
  const chain = useChainReadStatus();
  const margin = useMarginAvailability();
  const { disconnectAsync } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const hpke = useQuery({
    queryKey: ['diagnostics', 'hpke', identity?.enclavePubKey],
    enabled: Boolean(identity),
    queryFn: () => hpkeSelfTest(identity!.chainId, identity!.enclavePubKey),
    staleTime: Infinity,
  });

  const refreshPrivate = (name: string) => queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_ROOT, owner?.toLowerCase(), identity?.enclavePubKey, name] });
  const reconnect = async () => {
    await disconnectAsync().catch(() => undefined);
    openConnectModal?.();
  };

  const chainTone: Tone = chain.route === 'none' || chain.state === 'failed' ? 'bad' : chain.route === 'direct-dev' ? 'warn' : chain.state === 'ready' ? 'ok' : 'accent';

  return (
    <div className="space-y-6">
      {appConfig.issues.length > 0 && (
        <Notice tone="warn" title="Configuration issues">
          <ul className="list-disc pl-5">{appConfig.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </Notice>
      )}
      <Card>
        <CardHeader title="Safe actions" description="Refresh and reconnect only. Nothing here bypasses signing or changes accounting." />
        <CardBody className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={enclaveFetching} onClick={() => queryClient.invalidateQueries({ queryKey: ENCLAVE_QUERY_KEY })}>Refresh attestation</Button>
          <Button size="sm" variant="secondary" disabled={!session} onClick={() => refreshPrivate('balance')}>Refresh balances</Button>
          <Button size="sm" variant="secondary" disabled={!session} onClick={() => refreshPrivate('intents')}>Refresh intents</Button>
          <Button size="sm" variant="secondary" disabled={!session} onClick={() => refreshPrivate('withdrawals')}>Refresh withdrawals</Button>
          <Button size="sm" variant="secondary" disabled={!session || appConfig.marginUi === 'off'} onClick={() => { void refreshPrivate('margin-positions'); void refreshPrivate('margin-lending'); }}>Refresh margin</Button>
          <Button size="sm" variant="secondary" onClick={reconnect}>Reconnect wallet</Button>
          <Button size="sm" variant="secondary" disabled={!canUnlock} loading={unlock.isPending} onClick={() => unlock.mutate()}>Re-establish read session</Button>
          <Button size="sm" variant="secondary" disabled={chain.route !== 'anon-rpc'} onClick={() => { chainReader.reset(); void chainReader.start().catch(() => undefined); }}>Start / retry Anon-RPC</Button>
        </CardBody>
        {unlock.error && <CardBody className="pt-0"><Notice tone="error">{describeError(unlock.error)}</Notice></CardBody>}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="API and enclave" />
          <CardBody>
            <dl className="divide-y divide-ink-700">
              <Row label="Environment">{process.env.NODE_ENV}</Row>
              <Row label="API base URL">{appConfig.apiUrl ? <span className="break-all font-mono text-xs">{appConfig.apiUrl}</span> : <Badge tone="bad">Not set</Badge>}</Row>
              <Row label="Last API success">{diagnostics.lastApiSuccessPath ? `${diagnostics.lastApiSuccessPath} at ${ms(diagnostics.lastApiSuccessAt)}` : 'none yet'}</Row>
              <Row label="Last API error" tone={diagnostics.lastApiError ? 'bad' : 'ok'} status={diagnostics.lastApiError ? diagnostics.lastApiError.code : 'none'}>
                {diagnostics.lastApiError && <span className="text-xs text-fg-subtle">{diagnostics.lastApiError.path} at {ms(diagnostics.lastApiError.at)}</span>}
              </Row>
              <Row label="Configured chain ID">{appConfig.chainId} ({appConfig.chain.name})</Row>
              <Row label="Enclave key" status={identity ? 'retrieved' : enclaveError ? 'failed' : 'loading'} tone={identity ? 'ok' : enclaveError ? 'bad' : 'neutral'}>
                {identity && <Address value={identity.enclavePubKey} head={8} tail={6} />}
                {enclaveError && <span className="text-xs text-fg-subtle">{describeError(enclaveError)}</span>}
              </Row>
              <Row label="Attestation" status={identity?.mode === 'attested-unverified' ? 'received, not verified in browser' : identity?.mode === 'simulated' ? 'none (simulated key)' : 'unknown'} tone={identity?.mode === 'simulated' ? 'warn' : 'accent'} />
              <Row label="Simulation" status={identity?.mode === 'simulated' ? 'TEE-SIMULATED' : identity ? 'not simulated' : 'unknown'} tone={identity?.mode === 'simulated' ? 'warn' : 'neutral'}>
                <span className="text-xs text-fg-subtle">Simulated keys {appConfig.allowSimulatedEnclave ? 'allowed' : 'refused'} by this build</span>
              </Row>
              <Row label="HPKE transport" status={hpke.data?.ok ? 'available' : hpke.data ? 'unavailable' : identity ? 'testing' : 'needs enclave key'} tone={hpke.data?.ok ? 'ok' : hpke.data ? 'bad' : 'neutral'}>
                <span className="text-xs text-fg-subtle">X25519 · HKDF-SHA256 · AES-256-GCM, local seal test</span>
              </Row>
              <Row label="Aggregate health (/health/reconcile)" status="not served" tone="neutral">
                <span className="text-xs text-fg-subtle">Documented in docs/api.md but not registered by the enclave server</span>
              </Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Wallet and session" />
          <CardBody>
            <dl className="divide-y divide-ink-700">
              <Row label="Wallet" status={isConnected ? 'connected' : 'disconnected'} tone={isConnected ? 'ok' : 'neutral'}>{owner && <Address value={owner} />}</Row>
              <Row label="Connector">{connectorName ?? '—'}</Row>
              <Row label="Wallet network" status={walletChainId === undefined ? 'unknown' : wrongChain ? `wrong (${walletChainId})` : String(walletChainId)} tone={wrongChain ? 'bad' : walletChainId ? 'ok' : 'neutral'} />
              <Row label="Read session" status={session ? 'active' : 'none'} tone={session ? 'ok' : 'neutral'}>
                {session && <span className="text-xs text-fg-subtle">expires in <Countdown deadline={session.expiresAt} /> · key <span className="font-mono">{session.sessionAddress.slice(0, 8)}…</span> (memory only)</span>}
              </Row>
              <Row label="Last balance refresh">{ms(diagnostics.lastBalanceRefreshAt)}</Row>
              <Row
                label="Margin"
                status={{ 'off-by-config': 'off in this build', 'needs-session': 'unknown (needs read session)', checking: 'checking', enabled: 'routes live', disabled: 'disabled on enclave', error: margin.errorCode ?? 'error' }[margin.availability]}
                tone={margin.availability === 'enabled' ? 'ok' : margin.availability === 'error' ? 'bad' : 'neutral'}
              >
                {margin.availability === 'enabled' && identity?.mode === 'simulated' && <Badge tone="warn">mock accounting</Badge>}
              </Row>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Anon-RPC and browser chain reads" description="Which browser reads go where. Counts are for this page load." />
        <CardBody className="space-y-4">
          <dl className="divide-y divide-ink-700">
            <Row label="Route" status={chain.route === 'anon-rpc' ? 'Anon-RPC' : chain.route === 'direct-dev' ? 'DIRECT RPC (dev fallback, not anonymized)' : 'none: reads disabled'} tone={chainTone} />
            <Row label="State" status={chain.state} tone={chainTone}><span className="max-w-xl text-xs text-fg-subtle">{chain.detail}</span></Row>
            <Row label="Reads">{chain.totalReads} total · {chain.failedReads} failed · last {ms(chain.lastReadAt)}</Row>
            <Row label="By method">
              {Object.keys(chain.byMethod).length === 0 ? <span className="text-xs text-fg-subtle">none yet</span> : Object.entries(chain.byMethod).map(([method, count]) => <Badge key={method}>{method}: {count}</Badge>)}
            </Row>
            <Row label="Specifier">{appConfig.chainRead.anonSpecifier ? <Address value={appConfig.chainRead.anonSpecifier} /> : '—'}</Row>
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">Browser reads using the chain reader</p>
              <ul className="space-y-1 text-sm text-fg-muted">
                {BROWSER_READS.map((read) => <li key={read.name}>{read.name} <span className="text-xs text-fg-faint">({read.methods.join(', ')})</span></li>)}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">Traffic that does not use Anon-RPC</p>
              <ul className="space-y-2 text-sm text-fg-muted">
                {BYPASSING_TRAFFIC.map((item) => <li key={item.name}><span className="text-fg">{item.name}.</span> <span className="text-xs text-fg-subtle">{item.reason}</span></li>)}
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
