import { NATIVE } from '@cloakroom/shared';
import { parseEther } from 'viem';
import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { depositTransfers, missingFunds } from '@/lib/deposit/funding';

const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const RESERVE = parseEther('0.01');
const HUNDRED = 100_000_000n;

describe('depositTransfers', () => {
  it('adds the reserve to an ETH deposit, so the amount typed is what gets credited', () => {
    expect(depositTransfers(NATIVE, parseEther('0.03'), RESERVE)).toEqual({ native: parseEther('0.04'), token: 0n });
  });

  it('sends the reserve as ETH beside a USDC deposit', () => {
    expect(depositTransfers(USDC, HUNDRED, RESERVE)).toEqual({ native: RESERVE, token: HUNDRED });
  });

  it('asks for no extra ETH on a server with no reserve', () => {
    expect(depositTransfers(NATIVE, parseEther('0.03'), 0n)).toEqual({ native: parseEther('0.03'), token: 0n });
  });
});

describe('missingFunds', () => {
  const received = (asset: Address, nativeReceived: bigint, tokenReceived: bigint) => ({
    asset, gasReserveWei: RESERVE, nativeReceived, tokenReceived,
  });

  it('asks for everything when nothing has arrived', () => {
    expect(missingFunds(received(USDC, 0n, 0n), HUNDRED)).toEqual({ native: RESERVE, token: HUNDRED });
    expect(missingFunds(received(NATIVE, 0n, 0n), parseEther('0.03'))).toEqual({ native: parseEther('0.04'), token: 0n });
  });

  it('asks only for the ETH once the USDC has arrived', () => {
    expect(missingFunds(received(USDC, 0n, HUNDRED), HUNDRED)).toEqual({ native: RESERVE, token: 0n });
  });

  it('asks only for the rest of a partly sent reserve', () => {
    expect(missingFunds(received(USDC, parseEther('0.004'), HUNDRED), null)).toEqual({ native: parseEther('0.006'), token: 0n });
  });

  it('asks only for the USDC once the ETH has arrived', () => {
    expect(missingFunds(received(USDC, RESERVE, 0n), HUNDRED)).toEqual({ native: 0n, token: HUNDRED });
  });

  it('reports an unknown USDC amount after a refresh, rather than guessing', () => {
    expect(missingFunds(received(USDC, RESERVE, 0n), null)).toEqual({ native: 0n, token: null });
  });

  it('treats any USDC received as enough, as the server does', () => {
    expect(missingFunds(received(USDC, RESERVE, 1n), HUNDRED)).toEqual({ native: 0n, token: 0n });
  });

  it('needs nothing more once ETH is above the reserve', () => {
    expect(missingFunds(received(NATIVE, RESERVE + 1n, 0n), parseEther('0.03'))).toEqual({ native: 0n, token: 0n });
  });

  it('after a refresh, asks an ETH deposit only to fill the reserve', () => {
    expect(missingFunds(received(NATIVE, parseEther('0.004'), 0n), null)).toEqual({ native: parseEther('0.006'), token: 0n });
  });
});
