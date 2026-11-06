import { tokenFor } from '@/lib/config';
import { formatUnitsDisplay, formatUnitsExact } from '@/lib/format/units';
import { truncateMiddle } from '@/lib/format/address';

/**
 * Renders a wire decimal string (base units) with the token's decimals. An unknown token is shown
 * in raw base units with its address, never guessed. A malformed value is shown as unavailable.
 */
export function Amount({ value, token, maxFraction = 6, className, signed = false }: { value: string | bigint; token: string; maxFraction?: number; className?: string; signed?: boolean }) {
  const config = tokenFor(token);
  try {
    const amount = typeof value === 'bigint' ? value : (signed ? /^-?\d+$/ : /^\d+$/).test(value) ? BigInt(value) : null;
    if (amount === null) return <span className="text-fg-faint">Unavailable</span>;
    if (!config) {
      return (
        <span className={className} title={`Unknown token ${token}`}>
          <span className="tabular-nums">{amount.toString()}</span> <span className="text-fg-subtle">base units of {truncateMiddle(token)}</span>
        </span>
      );
    }
    return (
      <span className={className} title={`${formatUnitsExact(amount, config.decimals)} ${config.symbol}`}>
        <span className="tabular-nums">{formatUnitsDisplay(amount, config.decimals, maxFraction)}</span>{' '}
        <span className="text-fg-subtle">{config.symbol}</span>
      </span>
    );
  } catch {
    return <span className="text-fg-faint">Unavailable</span>;
  }
}

export function TokenSymbol({ token }: { token: string }) {
  return <>{tokenFor(token)?.symbol ?? truncateMiddle(token)}</>;
}
