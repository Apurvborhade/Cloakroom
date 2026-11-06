import { NATIVE } from '@cloakroom/shared';
import { getAddress, isAddress } from 'viem';
import type { Address } from 'viem';
import { AmountError, parseUnitsStrict } from '../format/units';

export interface WithdrawFormInput {
  token: Address;
  decimals: number;
  amount: string;
  destination: string;
}

export interface WithdrawFormResult {
  amount: bigint | null;
  to: Address | null;
  errors: { amount?: string; destination?: string };
  warnings: string[];
}

/** Mirrors the enclave's checks (positive amount, non-zero destination, ETH cap) before signing. */
export function validateWithdrawForm(
  input: WithdrawFormInput,
  limits: { availableBaseUnits: bigint | null; maxNativeWei: bigint; owner: Address | undefined },
): WithdrawFormResult {
  const errors: WithdrawFormResult['errors'] = {};
  const warnings: string[] = [];
  let amount: bigint | null = null;
  if (input.amount.trim()) {
    try {
      const value = parseUnitsStrict(input.amount, input.decimals);
      if (value === 0n) errors.amount = 'Enter an amount above zero';
      else if (input.token.toLowerCase() === NATIVE && value > limits.maxNativeWei) errors.amount = 'Above the enclave maximum for one ETH withdrawal';
      else if (limits.availableBaseUnits !== null && value > limits.availableBaseUnits) errors.amount = 'More than your available private balance';
      else amount = value;
    } catch (error) {
      errors.amount = error instanceof AmountError ? error.message : 'Invalid amount';
    }
  }

  let to: Address | null = null;
  const destination = input.destination.trim();
  if (destination) {
    if (!isAddress(destination, { strict: false })) errors.destination = 'Not a valid Ethereum address';
    else if (/[A-F]/.test(destination.slice(2)) && /[a-f]/.test(destination.slice(2)) && !isAddress(destination, { strict: true })) {
      errors.destination = 'Checksum mismatch: check the address for typos';
    } else if (getAddress(destination) === getAddress(NATIVE)) errors.destination = 'The zero address cannot receive withdrawals';
    else to = getAddress(destination);
  }
  if (to && limits.owner && to === getAddress(limits.owner)) {
    warnings.push('This is your connected wallet. Paying out to the wallet you deposited from links the two publicly; a fresh address keeps them apart.');
  }
  return { amount, to, errors, warnings };
}
