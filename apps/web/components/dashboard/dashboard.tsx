'use client';

import { useEnclave } from '@/hooks/use-enclave';
import { useMarginAvailability } from '@/hooks/use-private-data';
import { useOwner } from '@/hooks/use-owner';
import { useSession } from '@/hooks/use-session';
import { appConfig } from '@/lib/config';
import { explorerAddressUrl } from '@/lib/format/address';
import { IntentList } from '../trading/intent-list';
import { MarginOverview } from '../trading/margin/margin-overview';
import { WithdrawalList } from '../transactions/withdrawal-list';
import { Address } from '../ui/address';
import { Badge } from '../ui/badge';
import { Card, CardBody, CardHeader } from '../ui/card';
import { KeyValue, KeyValueList } from '../ui/key-value';
import { Notice } from '../ui/notice';
import { RequireWallet, SessionIndicator, SessionUnlock } from '../wallet/gates';
import { AttestationPanel } from './attestation-panel';
import { BalancePanel } from './balance-panel';

function AccountCard() {
  const { owner, connectorName, walletChainId, wrongChain } = useOwner();
  const { identity } = useEnclave();
  return (
    <Card>
      <CardHeader title="Account" description="Your primary wallet signs every action that moves funds." />
      <CardBody>
        <KeyValueList>
          <KeyValue label="Wallet">{owner ? <Address value={owner} href={explorerAddressUrl(appConfig.explorerUrl, owner)} /> : '—'}</KeyValue>
          <KeyValue label="Connector">{connectorName ?? '—'}</KeyValue>
          <KeyValue label="Network">
            {wrongChain ? <Badge tone="bad" dot>Chain {walletChainId} (expected {appConfig.chainId})</Badge> : <Badge tone="ok" dot>{appConfig.chain.name}</Badge>}
          </KeyValue>
          <KeyValue label="Enclave mode">
            {identity?.mode === 'simulated' ? <Badge tone="warn" dot>TEE-simulated</Badge> : identity?.mode === 'attested-verified' ? <Badge tone="ok" dot>Attestation verified</Badge> : identity ? <Badge tone="accent" dot>Attestation available</Badge> : <Badge tone="neutral">Unknown</Badge>}
          </KeyValue>
          <KeyValue label="Read session"><SessionIndicator /></KeyValue>
        </KeyValueList>
      </CardBody>
    </Card>
  );
}

function MarginSection() {
  const { availability } = useMarginAvailability();
  if (availability === 'enabled') return <MarginOverview compact />;
  if (availability === 'disabled') return <Notice tone="info" title="Margin">Not enabled on this enclave.</Notice>;
  return null;
}

export function Dashboard() {
  const { active } = useSession();
  const { ready } = useOwner();
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <RequireWallet>
          <AccountCard />
        </RequireWallet>
        <AttestationPanel />
      </div>
      {ready && (active ? (
          <div className="space-y-6">
            <BalancePanel />
            <div className="grid gap-6 xl:grid-cols-2">
              <IntentList limit={5} title="Recent intents" />
              <WithdrawalList limit={5} title="Recent withdrawals" />
            </div>
            {appConfig.marginUi !== 'off' && <MarginSection />}
          </div>
        ) : (
          <SessionUnlock />
        ))}
    </div>
  );
}
