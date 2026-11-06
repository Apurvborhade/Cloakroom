import { Badge } from './badge';
import type { Tone } from './badge';

const INTENT: Record<string, { tone: Tone; label: string; hint: string }> = {
  pending: { tone: 'accent', label: 'Pending', hint: 'Funds reserved; waiting for the price condition.' },
  executing: { tone: 'warn', label: 'Executing', hint: 'The enclave is executing the swap on-chain.' },
  done: { tone: 'ok', label: 'Done', hint: 'Swap confirmed; net output credited to your private balance.' },
  failed: { tone: 'bad', label: 'Failed', hint: 'The swap did not complete; reserved funds were released.' },
  cancelled: { tone: 'neutral', label: 'Cancelled', hint: 'Cancelled by you; reserved funds were released.' },
  expired: { tone: 'neutral', label: 'Expired', hint: 'The order expired; reserved funds were released.' },
};

const WITHDRAWAL: Record<string, { tone: Tone; label: string; hint: string }> = {
  locked: { tone: 'accent', label: 'Locked', hint: 'Funds reserved and a paying address assigned. Not sent yet.' },
  sent: { tone: 'warn', label: 'Sent', hint: 'Broadcast, or result not yet known. Waiting for confirmation.' },
  confirmed: { tone: 'ok', label: 'Confirmed', hint: 'Payout confirmed on-chain.' },
  failed: { tone: 'bad', label: 'Failed', hint: 'The payout failed; reserved funds were released.' },
};

const POSITION: Record<string, { tone: Tone; label: string; hint: string }> = {
  opening: { tone: 'warn', label: 'Opening', hint: 'Approved; the opening swap is executing.' },
  open: { tone: 'ok', label: 'Open', hint: 'Position is open.' },
  closing: { tone: 'warn', label: 'Closing', hint: 'The closing swap is executing.' },
  liquidating: { tone: 'bad', label: 'Liquidating', hint: 'Below maintenance margin; being liquidated.' },
  closed: { tone: 'neutral', label: 'Closed', hint: 'Closed by you.' },
  liquidated: { tone: 'bad', label: 'Liquidated', hint: 'Closed by liquidation.' },
  failed: { tone: 'bad', label: 'Failed', hint: 'The opening swap failed.' },
};

function render(map: Record<string, { tone: Tone; label: string; hint: string }>, status: string) {
  const entry = map[status] ?? { tone: 'neutral' as Tone, label: status, hint: '' };
  return (
    <span title={entry.hint}>
      <Badge tone={entry.tone} dot>
        {entry.label}
      </Badge>
    </span>
  );
}

export const IntentStatusBadge = ({ status }: { status: string }) => render(INTENT, status);
export const WithdrawalStatusBadge = ({ status }: { status: string }) => render(WITHDRAWAL, status);
export const PositionStatusBadge = ({ status }: { status: string }) => render(POSITION, status);
export const statusHint = { intent: INTENT, withdrawal: WITHDRAWAL, position: POSITION };
