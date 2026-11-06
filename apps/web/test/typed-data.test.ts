import { deriveEnclaveSalt, EIP712_TYPES, NATIVE, SignedIntentSchema, SignedMarginOpenSchema, SignedWithdrawalSchema, wireToIntentMsg, wireToMarginOpenMsg } from '@cloakroom/shared';
import { recoverTypedDataAddress } from 'viem';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { nextNonce, resetNonceForTests } from '@/lib/wallet/nonce';
import {
  buildIntent,
  buildMarginOpen,
  buildSessionGrant,
  buildWithdrawal,
  domainFor,
  mutationExpiry,
  signRequest,
} from '@/lib/wallet/typed-data';

const enclavePubKey = `0x${'ab'.repeat(32)}` as Hex;
const binding = { chainId: 11155111, enclavePubKey };
const account = privateKeyToAccount(generatePrivateKey());
const signer = (args: Parameters<typeof account.signTypedData>[0]) => account.signTypedData(args);
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;

describe('EIP-712 construction', () => {
  it('binds the domain to the chain and keccak256(enclave key)', () => {
    expect(domainFor(binding)).toEqual({ name: 'PrivateIntentNetwork', version: '1', chainId: 11155111, salt: deriveEnclaveSalt(enclavePubKey) });
  });

  it('builds an Intent whose wire form parses back to exactly the signed message', async () => {
    const request = buildIntent(binding, {
      owner: account.address, tokenIn: NATIVE, tokenOut: USDC, amountIn: 10n ** 17n, comparator: 0,
      triggerPrice: 3_000n * 10n ** 18n, maxSlippageBps: 50, nonce: 7n, expiry: 1_790_000_000n,
    });
    expect(request.wire).toEqual({
      owner: account.address, tokenIn: NATIVE, tokenOut: USDC, amountIn: '100000000000000000', comparator: 0,
      triggerPrice: '3000000000000000000000', maxSlippageBps: 50, nonce: '7', expiry: '1790000000',
    });
    const signed = await signRequest(signer as never, request);
    const parsed = SignedIntentSchema.parse(signed);
    const recovered = await recoverTypedDataAddress({
      domain: domainFor(binding), types: EIP712_TYPES, primaryType: 'Intent', message: wireToIntentMsg(parsed.message), signature: parsed.signature,
    });
    expect(recovered).toBe(account.address);
  });

  it('signs MarginOpen side as uint8 and sends it as a word', async () => {
    const request = buildMarginOpen(binding, {
      owner: account.address, side: 1, collateral: 5n, leverageBps: 40_000, limitPrice: 1n, maxSlippageBps: 10, nonce: 1n, expiry: 2n,
    });
    expect(request.message.side).toBe(1);
    expect(request.wire.side).toBe('short');
    const signed = SignedMarginOpenSchema.parse(await signRequest(signer as never, request));
    expect(wireToMarginOpenMsg(signed.message).side).toBe(1);
    const recovered = await recoverTypedDataAddress({
      domain: domainFor(binding), types: EIP712_TYPES, primaryType: 'MarginOpen', message: wireToMarginOpenMsg(signed.message), signature: signed.signature,
    });
    expect(recovered).toBe(account.address);
  });

  it('puts the withdrawal destination inside the signature', async () => {
    const to = privateKeyToAccount(generatePrivateKey()).address;
    const request = buildWithdrawal(binding, { owner: account.address, token: NATIVE, amount: 1n, to, nonce: 1n, expiry: 2n });
    const signed = SignedWithdrawalSchema.parse(await signRequest(signer as never, request));
    const tampered = { ...signed.message, to: privateKeyToAccount(generatePrivateKey()).address };
    const recovered = await recoverTypedDataAddress({
      domain: domainFor(binding), types: EIP712_TYPES, primaryType: 'Withdrawal',
      message: { ...tampered, amount: 1n, nonce: 1n, expiry: 2n }, signature: signed.signature,
    });
    expect(recovered).not.toBe(account.address);
  });

  it('builds session grants with the session key as a field', () => {
    const request = buildSessionGrant(binding, { owner: account.address, sessionKey: USDC, expiry: 10n });
    expect(request.primaryType).toBe('SessionGrant');
    expect(request.wire).toEqual({ owner: account.address, sessionKey: USDC, expiry: '10' });
  });

  it('refuses out-of-range enums', () => {
    expect(() => buildIntent(binding, { owner: account.address, tokenIn: NATIVE, tokenOut: USDC, amountIn: 1n, comparator: 2, triggerPrice: 1n, maxSlippageBps: 0, nonce: 1n, expiry: 1n })).toThrow();
    expect(() => buildMarginOpen(binding, { owner: account.address, side: 3, collateral: 1n, leverageBps: 10_000, limitPrice: 1n, maxSlippageBps: 0, nonce: 1n, expiry: 1n })).toThrow();
  });
});

describe('nonces and expiry', () => {
  afterEach(() => resetNonceForTests());

  it('is strictly increasing even within one millisecond', () => {
    const clock = () => 1_000;
    const a = nextNonce(clock);
    const b = nextNonce(clock);
    const c = nextNonce(() => 999);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('keeps mutation expiry inside the enclave window', () => {
    expect(mutationExpiry(1_000)).toBe(1_180n);
  });
});
