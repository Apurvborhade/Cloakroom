// @vitest-environment node
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { CloakroomApi } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { GRANT_LIFETIME_SEC, SessionStore } from '@/lib/session/session-store';

const binding = { chainId: 11155111, enclavePubKey: `0x${'cd'.repeat(32)}` as Hex };
const owner = privateKeyToAccount(generatePrivateKey());
const signer = (args: unknown) => owner.signTypedData(args as Parameters<typeof owner.signTypedData>[0]);

/** Stands in for the HTTP layer only: the grant is still signed for real. */
function apiReturning(expiresAt: number) {
  const api = new CloakroomApi({ baseUrl: 'https://api.example' });
  const spy = vi.spyOn(api, 'postPrivate').mockImplementation(async (path, payload) => {
    expect(path).toBe('/session');
    const grant = (payload as { message: { expiry: string; sessionKey: string } }).message;
    return { ok: true as const, expiresAt: Math.min(expiresAt, Number(grant.expiry)) } as never;
  });
  return { api, spy };
}

describe('SessionStore', () => {
  it('asks for a grant no longer than the enclave allows and exposes no key', async () => {
    let now = 1_000_000;
    const store = new SessionStore(() => now);
    const { api, spy } = apiReturning(now + 10_000);
    const session = await store.establish({ owner: owner.address, binding, ownerSigner: signer as never, api });
    const grant = (spy.mock.calls[0]![1] as { message: { expiry: string; sessionKey: string; owner: string } }).message;
    expect(Number(grant.expiry) - now).toBe(GRANT_LIFETIME_SEC);
    expect(GRANT_LIFETIME_SEC).toBeLessThanOrEqual(1800);
    expect(grant.sessionKey).toBe(session.sessionAddress);
    expect(grant.sessionKey).not.toBe(owner.address);
    // The snapshot exposes addresses only: nothing 32 bytes long (a private key) is reachable.
    expect(Object.keys(store.getSnapshot()!).sort()).toEqual(['chainId', 'enclavePubKey', 'expiresAt', 'owner', 'sessionAddress']);
    expect(store.isActive(owner.address, binding)).toBe(true);
  });

  describe('across a page refresh', () => {
    const memoryStorage = () => {
      const items = new Map<string, string>();
      return {
        items,
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      };
    };

    it('keeps the session without another signature, and forgets it when ended', async () => {
      const now = 1_000_000;
      const storage = memoryStorage();
      const first = new SessionStore(() => now, storage);
      const { api } = apiReturning(now + 1_000);
      const session = await first.establish({ owner: owner.address, binding, ownerSigner: signer as never, api });

      const reloaded = new SessionStore(() => now, storage);
      expect(reloaded.getSnapshot()).toEqual(session);
      expect(reloaded.isActive(owner.address, binding)).toBe(true);
      const query = await reloaded.signQuery(owner.address, binding);
      expect(query.message.owner.toLowerCase()).toBe(owner.address.toLowerCase());

      reloaded.end('manual');
      expect(storage.items.size).toBe(0);
      expect(new SessionStore(() => now, storage).getSnapshot()).toBeNull();
    });

    it('does not restore an expired session or unreadable data', async () => {
      let now = 1_000_000;
      const storage = memoryStorage();
      const { api } = apiReturning(now + 1_000);
      await new SessionStore(() => now, storage).establish({ owner: owner.address, binding, ownerSigner: signer as never, api });
      now += 2_000;
      expect(new SessionStore(() => now, storage).getSnapshot()).toBeNull();
      expect(storage.items.size).toBe(0);

      storage.setItem('cloakroom.read-session', 'not json');
      expect(new SessionStore(() => now, storage).getSnapshot()).toBeNull();
    });
  });

  it('signs queries with the session key, not the owner', async () => {
    const now = 1_000_000;
    const store = new SessionStore(() => now);
    const { api } = apiReturning(now + 1_000);
    const session = await store.establish({ owner: owner.address, binding, ownerSigner: signer as never, api });
    const query = await store.signQuery(owner.address, binding);
    const { recoverTypedDataAddress } = await import('viem');
    const { EIP712_TYPES } = await import('@cloakroom/shared');
    const { domainFor } = await import('@/lib/wallet/typed-data');
    const recovered = await recoverTypedDataAddress({
      domain: domainFor(binding), types: EIP712_TYPES, primaryType: 'SessionQuery',
      message: { owner: query.message.owner, expiry: BigInt(query.message.expiry) }, signature: query.signature,
    });
    expect(recovered).toBe(session.sessionAddress);
    expect(Number(query.message.expiry) - now).toBeLessThanOrEqual(300);
  });

  it('expires on its own and then refuses to sign', async () => {
    let now = 1_000_000;
    const store = new SessionStore(() => now);
    const { api } = apiReturning(now + 100);
    await store.establish({ owner: owner.address, binding, ownerSigner: signer as never, api });
    now += 90; // inside the 15 s safety margin
    expect(store.isActive(owner.address, binding)).toBe(false);
    expect(store.lastEndReason).toBe('expired');
    await expect(store.signQuery(owner.address, binding)).rejects.toSatisfy((error: unknown) => error instanceof ApiError && error.code === 'NO_SESSION');
  });

  it('is invalid for another account or another enclave key', async () => {
    const store = new SessionStore(() => 1_000_000);
    const { api } = apiReturning(1_001_000);
    await store.establish({ owner: owner.address, binding, ownerSigner: signer as never, api });
    const other = privateKeyToAccount(generatePrivateKey()).address;
    expect(store.isActive(other, binding)).toBe(false);
    expect(store.isActive(owner.address, { ...binding, enclavePubKey: `0x${'ef'.repeat(32)}` })).toBe(false);
    expect(store.isActive(owner.address, { ...binding, chainId: 1 })).toBe(false);
    await expect(store.signQuery(other, binding)).rejects.toBeInstanceOf(ApiError);
  });

  it('drops everything when ended and notifies subscribers', async () => {
    const store = new SessionStore(() => 1_000_000);
    const { api } = apiReturning(1_001_000);
    await store.establish({ owner: owner.address, binding, ownerSigner: signer as never, api });
    const listener = vi.fn();
    store.subscribe(listener);
    store.end('account-changed');
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).toBeNull();
    expect(store.lastEndReason).toBe('account-changed');
  });

  it('does not keep a session when the owner rejects the grant', async () => {
    const store = new SessionStore(() => 1_000_000);
    const { api, spy } = apiReturning(1_001_000);
    const rejecting = async () => { throw Object.assign(new Error('rejected'), { code: 4001 }); };
    await expect(store.establish({ owner: owner.address, binding, ownerSigner: rejecting, api })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBeNull();
  });
});
