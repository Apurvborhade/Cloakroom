import { NATIVE } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';

/**
 * What a deposit address must receive. Each new address keeps a gas reserve in ETH, so a USDC
 * deposit also needs ETH sent to it, and ETH above the reserve is what gets credited.
 */
export interface DepositTransfers {
  native: bigint;
  token: bigint;
}

const isNative = (asset: Address) => getAddress(asset) === getAddress(NATIVE);
const atLeastZero = (value: bigint) => (value > 0n ? value : 0n);

/** `amount` is what the user wants credited, in the asset's base units. */
export function depositTransfers(asset: Address, amount: bigint, gasReserveWei: bigint): DepositTransfers {
  return isNative(asset) ? { native: amount + gasReserveWei, token: 0n } : { native: gasReserveWei, token: amount };
}

export interface ReceivedFunds {
  asset: Address;
  gasReserveWei: bigint;
  nativeReceived: bigint;
  tokenReceived: bigint;
}

export interface MissingFunds {
  native: bigint;
  /** Null when some token is needed but the amount isn't known, such as after a page refresh. */
  token: bigint | null;
}

/**
 * What is still missing, given what the enclave has seen arrive. `amount` is null after a refresh,
 * because the server only knows what was received, not what was planned. Received amounts lag behind
 * the chain, so callers must not ask again for a transfer that was just sent.
 */
export function missingFunds(received: ReceivedFunds, amount: bigint | null): MissingFunds {
  const { asset, gasReserveWei, nativeReceived, tokenReceived } = received;
  if (isNative(asset)) {
    // An ETH deposit completes as soon as it holds anything above the reserve.
    if (nativeReceived > gasReserveWei) return { native: 0n, token: 0n };
    return { native: atLeastZero(gasReserveWei + (amount ?? 0n) - nativeReceived), token: 0n };
  }
  const native = atLeastZero(gasReserveWei - nativeReceived);
  if (tokenReceived > 0n) return { native, token: 0n };
  return { native, token: amount };
}
