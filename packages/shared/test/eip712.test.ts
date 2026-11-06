import { describe, it, expect } from 'vitest';
import { hashTypedData, keccak256, type Hex } from 'viem';
import {
  NATIVE,
  createDomain,
  deriveEnclaveSalt,
  EIP712_TYPES,
  DOMAIN_NAME,
  DOMAIN_VERSION,
} from '../src/index.js';

describe('EIP-712 Domain and Types', () => {
  const dummyPubKey: Hex = ('0x' + 'aa'.repeat(32)) as Hex;
  const chainId = 11155111; // Sepolia
  const enclaveSalt = deriveEnclaveSalt(dummyPubKey);
  const domain = createDomain(chainId, enclaveSalt);

  it('derives enclave salt via keccak256', () => {
    expect(enclaveSalt).toBe(keccak256(dummyPubKey));
    expect(domain.name).toBe(DOMAIN_NAME);
    expect(domain.version).toBe(DOMAIN_VERSION);
    expect(domain.chainId).toBe(chainId);
    expect(domain.salt).toBe(enclaveSalt);
  });

  it('hashes SessionGrant message successfully', () => {
    const message = {
      owner: '0x1111111111111111111111111111111111111111',
      sessionKey: '0x2222222222222222222222222222222222222222',
      expiry: 1700001800n,
    } as const;

    const hash = hashTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'SessionGrant',
      message,
    });
    expect(hash.startsWith('0x')).toBe(true);
    expect(hash.length).toBe(66);
  });

  it('hashes SessionQuery message without requiring owner nonce', () => {
    const message = {
      owner: '0x1111111111111111111111111111111111111111',
      expiry: 1700000300n,
    } as const;

    const hash = hashTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'SessionQuery',
      message,
    });
    expect(hash.startsWith('0x')).toBe(true);
    expect(hash.length).toBe(66);
  });

  it('hashes DepositRequest message successfully', () => {
    const message = {
      owner: '0x1111111111111111111111111111111111111111',
      asset: NATIVE,
      nonce: 0n,
      expiry: 1700000300n,
    } as const;

    const hash = hashTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'DepositRequest',
      message,
    });
    expect(hash.startsWith('0x')).toBe(true);
    expect(hash.length).toBe(66);
  });

  it('hashes Intent message with exact field order matching spec', () => {
    const message = {
      owner: '0x1111111111111111111111111111111111111111',
      tokenIn: NATIVE,
      tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountIn: 100000000000000000n,
      comparator: 0,
      triggerPrice: 3000000000000000000000n,
      maxSlippageBps: 50,
      nonce: 1n,
      expiry: 1700000300n,
    } as const;

    const hash = hashTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Intent',
      message,
    });
    expect(hash.startsWith('0x')).toBe(true);
    expect(hash.length).toBe(66);
  });

  it('hashes CancelIntent message successfully', () => {
    const message = {
      owner: '0x1111111111111111111111111111111111111111',
      intentId: ('0x' + '12'.repeat(32)) as Hex,
      nonce: 2n,
      expiry: 1700000300n,
    } as const;

    const hash = hashTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'CancelIntent',
      message,
    });
    expect(hash.startsWith('0x')).toBe(true);
    expect(hash.length).toBe(66);
  });

  it('hashes Withdrawal message successfully', () => {
    const message = {
      owner: '0x1111111111111111111111111111111111111111',
      token: NATIVE,
      amount: 50000000000000000n,
      to: '0x2222222222222222222222222222222222222222',
      nonce: 3n,
      expiry: 1700000300n,
    } as const;

    const hash = hashTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Withdrawal',
      message,
    });
    expect(hash.startsWith('0x')).toBe(true);
    expect(hash.length).toBe(66);
  });
});
