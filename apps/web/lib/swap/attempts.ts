/** Why the server couldn't finish a swap on its last try, in plain words. */
export interface AttemptExplanation {
  title: string;
  detail: string;
  /** Who can fix it. Only the user can change their trigger or try again. */
  action: string;
}

const EXPLANATIONS: Record<string, AttemptExplanation> = {
  APPROVAL_FAILED: {
    title: "The pool address couldn't approve USDC",
    detail: 'An address approves Permit2 and the router the first time it sells USDC, and this failed. Nothing was swapped.',
    action: 'Try again. If this repeats, check that the address has ETH for gas.',
  },
  LIMIT_NOT_MET: {
    title: 'The price moved past your worst acceptable price',
    detail: 'The swap would have filled too far from the price shown, so nothing was sent.',
    action: 'Try again.',
  },
  EXPIRED: {
    title: 'The operation ran out of time',
    detail: 'It took too long to start, so nothing was sent.',
    action: 'Try again.',
  },
  INTERRUPTED: {
    title: 'The server restarted before sending this',
    detail: 'Nothing was sent, and your funds were returned.',
    action: 'Try again.',
  },
  NO_INVENTORY: {
    title: 'No pool address can run this swap',
    detail: 'It must come from one address that you did not deposit to, holding the whole swap amount plus its gas reserve.',
    action: 'Fund the pool, or try a smaller amount.',
  },
  INVENTORY_UNAVAILABLE: {
    title: "Couldn't read the pool's balances",
    detail: "The server's connection to the chain failed on this try.",
    action: 'It retries at the next price check.',
  },
  CONDITION_NOT_MET: {
    title: "The swap's own quote was below your trigger",
    detail: 'The price check passed, but the quote for your exact amount came in lower.',
    action: 'Use a lower trigger price.',
  },
  NO_ROOM_ABOVE_LIMIT: {
    title: 'Your trigger leaves no room for slippage',
    detail: 'The quote is too close to your trigger to swap safely.',
    action: 'Use a lower trigger price.',
  },
  QUOTE_UNAVAILABLE: {
    title: "Couldn't get a quote from Uniswap",
    detail: 'The Trading API failed or refused the request on this try.',
    action: 'It retries at the next price check.',
  },
  NO_TRANSACTION: {
    title: 'Uniswap returned a quote with no transaction',
    detail: 'The Trading API priced the swap but did not build it.',
    action: 'It retries at the next price check.',
  },
  UNEXPECTED_TRANSACTION: {
    title: "Uniswap's transaction didn't match the swap",
    detail: 'The router, sender or amount was not what the server expected, so it refused to sign.',
    action: 'If this repeats, check the server configuration.',
  },
  UNSAFE_CALLDATA: {
    title: "Uniswap's transaction failed the safety check",
    detail: 'The server could not prove the output would reach the pool address, so it refused to sign.',
    action: 'If this repeats, check the swap route.',
  },
  SIMULATION_FAILED: {
    title: 'The swap failed in simulation',
    detail: 'It would have reverted, or gas could not be estimated, so nothing was sent.',
    action: 'If this repeats, check that pool address has enough ETH for gas.',
  },
  PREPARE_FAILED: {
    title: "The swap couldn't be signed",
    detail: 'Nothing was sent, and your funds were returned.',
    action: 'Try again. If this repeats, check the server logs.',
  },
  REVERTED: {
    title: 'The swap reverted on-chain',
    detail: 'The price likely moved past your minimum. Gas was spent, and your funds were returned.',
    action: 'Try again.',
  },
};

export function explainAttempt(reason: string | undefined | null): AttemptExplanation | null {
  if (!reason) return null;
  return EXPLANATIONS[reason] ?? { title: reason, detail: 'The server gave this code with no further detail.', action: 'Check the server logs.' };
}
