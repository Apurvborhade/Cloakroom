'use client';

import { useBalances } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { appConfig, knownTokens } from '@/lib/config';
import { Amount, TokenSymbol } from '../ui/amount';
import { Button } from '../ui/button';
import { LinkButton } from '../ui/link-button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Notice } from '../ui/notice';
import { Skeleton } from '../ui/skeleton';

/**
 * Available can be spent. Reserved is held for open intents and withdrawals. Pending is
 * display-only (deposits seen but not yet confirmed) and is currently always 0 in the API.
 */
export function BalancePanel({ showActions = true }: { showActions?: boolean }) {
  const balances = useBalances();
  const reported = new Set(balances.data?.balances.map((item) => item.token.toLowerCase()) ?? []);
  const missing = balances.data ? knownTokens().filter((token) => !reported.has(token.address.toLowerCase())) : [];

  return (
    <Card>
      <CardHeader
        title="Private balance"
        description="Held in the enclave's ledger. Only you (through your read session) can read it."
        action={
          <Button variant="ghost" size="sm" onClick={() => balances.refetch()} loading={balances.isFetching && !balances.isLoading}>
            Refresh
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {balances.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        )}
        {balances.error && <Notice tone="error" title="Could not load balances">{describeError(balances.error)}</Notice>}
        {balances.data && (
          <div className="grid gap-3 sm:grid-cols-2">
            {balances.data.balances.map((item) => (
              <div key={item.token} className="rounded-lg border border-ink-700 bg-ink-900/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
                    <TokenSymbol token={item.token} />
                  </span>
                  <span className="text-[11px] text-fg-faint">Available</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-fg">
                  <Amount value={item.available} token={item.token} />
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-fg-faint">Reserved</dt>
                    <dd className="text-fg-muted"><Amount value={item.reserved} token={item.token} /></dd>
                  </div>
                  <div>
                    <dt className="text-fg-faint" title="Deposits seen but not yet confirmed. Not spendable.">Pending</dt>
                    <dd className="text-fg-muted"><Amount value={item.pending} token={item.token} /></dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
        {missing.length > 0 && (
          <Notice tone="warn" title="Token configuration mismatch">
            The enclave did not report {missing.map((token) => token.symbol).join(', ')}. Check that NEXT_PUBLIC_TOKEN_OUT_ADDRESS matches the enclave's TOKEN_OUT_ADDRESS.
          </Notice>
        )}
        {showActions && (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/deposit" size="sm">Deposit ETH</LinkButton>
            {appConfig.tokenOut && <LinkButton href="/swap" size="sm" variant="secondary">New swap</LinkButton>}
            <LinkButton href="/withdraw" size="sm" variant="secondary">Withdraw</LinkButton>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
