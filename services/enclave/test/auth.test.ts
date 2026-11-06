import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress, type Address, type Hex } from 'viem';
import {
  ERROR_CODES,
  NATIVE,
  createDomain,
  deriveEnclaveSalt,
  EIP712_TYPES,
  type DepositRequestMsg,
  type IntentMsg,
  type SessionGrantMsg,
  type SessionQueryMsg,
  type WithdrawalMsg,
} from '@cloakroom/shared';
import { FifoSerialQueue } from '../src/queue.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger } from '../src/ledger.js';
import { AuthService, AuthError } from '../src/auth.js';

const ALICE_KEY: Hex =
  '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
const BOB_KEY: Hex =
  '0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1';
const SESSION_KEY_1: Hex =
  '0x6370fd033278c143036d1100f80b3d14204b3041c3796633605f637c969fff3a';
const SESSION_KEY_2: Hex =
  '0x649f766e03c6f376a9a7b5bb4d97f6c3826b0143891d4e0e5a88c3f41ff77f86';

const ENCLAVE_PUB_KEY: Hex = ('0x04' + 'aa'.repeat(64)) as Hex;
const TEST_JOURNAL_KEY: Hex =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('AuthService', () => {
  const chainId = 11155111;
  const alice = privateKeyToAccount(ALICE_KEY);
  const bob = privateKeyToAccount(BOB_KEY);
  const sessionUser1 = privateKeyToAccount(SESSION_KEY_1);
  const sessionUser2 = privateKeyToAccount(SESSION_KEY_2);

  let tempDir: string;
  let journal: EncryptedJournal;
  let queue: FifoSerialQueue;
  let ledger: InMemoryLedger;
  let authService: AuthService;
  let currentTimestamp: number;

  const clock = () => currentTimestamp;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cloakroom-auth-test-'));
    journal = new EncryptedJournal({
      filePath: join(tempDir, 'journal.bin'),
      key: TEST_JOURNAL_KEY,
      fsync: false,
    });
    queue = new FifoSerialQueue();
    ledger = new InMemoryLedger();
    currentTimestamp = 1700000000;

    authService = new AuthService({
      chainId,
      enclavePubKey: ENCLAVE_PUB_KEY,
      config: {
        sessionGrantTtlSec: 1800,
        maxExpiryFutureSec: 300,
        maxClockSkewSec: 60,
      },
      queue,
      journal,
      ledger,
      clock,
    });
  });

  afterEach(async () => {
    await journal.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Signature Verification', () => {
    it('valid owner signature accepted', async () => {
      const message: IntentMsg = {
        owner: alice.address,
        tokenIn: NATIVE,
        tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amountIn: 100000000000000000n,
        comparator: 0,
        triggerPrice: 3000n * 10n ** 18n,
        maxSlippageBps: 50,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      const domain = authService.getDomain();
      const signature = await alice.signTypedData({
        domain,
        types: EIP712_TYPES,
        primaryType: 'Intent',
        message,
      });

      const recovered = await authService.verifyOwnerSignature('Intent', message, signature);
      expect(recovered).toBe(getAddress(alice.address));
    });

    it('invalid signature rejected', async () => {
      const message: DepositRequestMsg = {
        owner: alice.address,
        asset: NATIVE,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      const invalidSignature = '0x1234' as Hex;

      await expect(
        authService.verifyOwnerSignature('DepositRequest', message, invalidSignature),
      ).rejects.toThrow(AuthError);

      try {
        await authService.verifyOwnerSignature('DepositRequest', message, invalidSignature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.BAD_SIGNATURE);
      }
    });

    it('altered message rejected', async () => {
      const originalMessage: IntentMsg = {
        owner: alice.address,
        tokenIn: NATIVE,
        tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amountIn: 100000000000000000n,
        comparator: 0,
        triggerPrice: 3000n * 10n ** 18n,
        maxSlippageBps: 50,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'Intent',
        message: originalMessage,
      });

      // Alter amountIn after signing
      const tamperedMessage = {
        ...originalMessage,
        amountIn: 200000000000000000n,
      };

      await expect(
        authService.verifyOwnerSignature('Intent', tamperedMessage, signature),
      ).rejects.toThrow(AuthError);

      try {
        await authService.verifyOwnerSignature('Intent', tamperedMessage, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.BAD_SIGNATURE);
      }
    });

    it('wrong signer rejected', async () => {
      const message: WithdrawalMsg = {
        owner: alice.address,
        token: NATIVE,
        amount: 50000000000000000n,
        to: bob.address,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      // Signed by Bob instead of Alice
      const signature = await bob.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'Withdrawal',
        message,
      });

      await expect(
        authService.verifyOwnerSignature('Withdrawal', message, signature),
      ).rejects.toThrow(AuthError);

      try {
        await authService.verifyOwnerSignature('Withdrawal', message, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.BAD_SIGNATURE);
      }
    });

    it('wrong chain rejected', async () => {
      const message: DepositRequestMsg = {
        owner: alice.address,
        asset: NATIVE,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      const wrongChainDomain = createDomain(1, authService.getEnclaveSalt()); // Mainnet instead of Sepolia
      const signature = await alice.signTypedData({
        domain: wrongChainDomain,
        types: EIP712_TYPES,
        primaryType: 'DepositRequest',
        message,
      });

      await expect(
        authService.verifyOwnerSignature('DepositRequest', message, signature),
      ).rejects.toThrow(AuthError);

      try {
        await authService.verifyOwnerSignature('DepositRequest', message, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.BAD_SIGNATURE);
      }
    });

    it('wrong enclave salt rejected', async () => {
      const message: DepositRequestMsg = {
        owner: alice.address,
        asset: NATIVE,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      const wrongSalt = deriveEnclaveSalt(('0x04' + 'bb'.repeat(64)) as Hex);
      const wrongSaltDomain = createDomain(chainId, wrongSalt);
      const signature = await alice.signTypedData({
        domain: wrongSaltDomain,
        types: EIP712_TYPES,
        primaryType: 'DepositRequest',
        message,
      });

      await expect(
        authService.verifyOwnerSignature('DepositRequest', message, signature),
      ).rejects.toThrow(AuthError);

      try {
        await authService.verifyOwnerSignature('DepositRequest', message, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.BAD_SIGNATURE);
      }
    });
  });

  describe('Expiry Policy and Clock Skew', () => {
    it('already expired request rejected', () => {
      const expiredTimestamp = BigInt(currentTimestamp - 100); // 100s in the past (clock skew is 60s)
      expect(() => authService.validateExpiry(expiredTimestamp, false)).toThrow(AuthError);

      try {
        authService.validateExpiry(expiredTimestamp, false);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('request within allowed clock skew accepted', () => {
      const skewTimestamp = BigInt(currentTimestamp - 30); // 30s in past (within 60s skew allowance)
      expect(() => authService.validateExpiry(skewTimestamp, false)).not.toThrow();
    });

    it('request beyond clock skew rejected', () => {
      const beyondSkewTimestamp = BigInt(currentTimestamp - 61); // 61s in past (> 60s skew)
      expect(() => authService.validateExpiry(beyondSkewTimestamp, false)).toThrow(AuthError);

      try {
        authService.validateExpiry(beyondSkewTimestamp, false);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('request too far into future rejected', () => {
      const farFutureTimestamp = BigInt(currentTimestamp + 301); // 301s in future (> 300s horizon)
      expect(() => authService.validateExpiry(farFutureTimestamp, false)).toThrow(AuthError);

      try {
        authService.validateExpiry(farFutureTimestamp, false);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('valid session grant accepted', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp + 1800), // exactly 30 min (1800s)
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      const grant = await authService.createSessionGrant(grantMessage, signature);
      expect(grant.owner).toBe(getAddress(alice.address));
      expect(grant.sessionKey).toBe(getAddress(sessionUser1.address));
      expect(grant.expiry).toBe(grantMessage.expiry);
    });

    it('session grant exceeding configured TTL rejected', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp + 1801), // 1801s (> 1800s TTL)
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      await expect(authService.createSessionGrant(grantMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.createSessionGrant(grantMessage, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('expired grant rejected', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp - 100),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      await expect(authService.createSessionGrant(grantMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.createSessionGrant(grantMessage, signature);
      } catch (err: unknown) {
        expect((err as AuthError).code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('grant expiry exactly equal to now is rejected', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      await expect(authService.createSessionGrant(grantMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.createSessionGrant(grantMessage, signature);
      } catch (err: unknown) {
        expect((err as AuthError).code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('grant expiry one second in the past is rejected', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp - 1),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      await expect(authService.createSessionGrant(grantMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.createSessionGrant(grantMessage, signature);
      } catch (err: unknown) {
        expect((err as AuthError).code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('grant expiry 30 seconds in the past is rejected, even though ordinary requests allow 60 seconds of skew', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp - 30),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      await expect(authService.createSessionGrant(grantMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.createSessionGrant(grantMessage, signature);
      } catch (err: unknown) {
        expect((err as AuthError).code).toBe(ERROR_CODES.EXPIRED);
      }
    });

    it('a valid future grant still succeeds', async () => {
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp + 600),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      const grant = await authService.createSessionGrant(grantMessage, signature);
      expect(grant.owner).toBe(getAddress(alice.address));
      expect(grant.sessionKey).toBe(getAddress(sessionUser1.address));
      expect(grant.expiry).toBe(grantMessage.expiry);
    });
  });

  describe('Session Authorization', () => {
    beforeEach(async () => {
      // Register an active session grant for Alice with sessionUser1
      const grantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser1.address,
        expiry: BigInt(currentTimestamp + 1800),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage,
      });

      await authService.createSessionGrant(grantMessage, signature);
    });

    it('valid session key can sign SessionQuery', async () => {
      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };

      const signature = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      const res = await authService.verifySessionQuery(queryMessage, signature);
      expect(res.owner).toBe(getAddress(alice.address));
      expect(res.sessionKey).toBe(getAddress(sessionUser1.address));
    });

    it('unknown session rejected', async () => {
      const queryMessage: SessionQueryMsg = {
        owner: bob.address, // Bob has no registered session grant
        expiry: BigInt(currentTimestamp + 100),
      };

      const signature = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      await expect(authService.verifySessionQuery(queryMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.verifySessionQuery(queryMessage, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.UNKNOWN_SESSION);
      }
    });

    it('wrong session key rejected', async () => {
      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };

      // Signed by sessionUser2 (not granted) instead of sessionUser1
      const signature = await sessionUser2.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      await expect(authService.verifySessionQuery(queryMessage, signature)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.verifySessionQuery(queryMessage, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.UNAUTHORIZED);
      }
    });

    it('grant for another owner rejected', async () => {
      // Bob tries to query Alice's data with Bob's own grant
      const bobGrantMessage: SessionGrantMsg = {
        owner: bob.address,
        sessionKey: sessionUser2.address,
        expiry: BigInt(currentTimestamp + 1800),
      };
      const bobGrantSig = await bob.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: bobGrantMessage,
      });
      await authService.createSessionGrant(bobGrantMessage, bobGrantSig);

      // Now query Alice claiming sessionUser2
      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };
      const querySig = await sessionUser2.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      await expect(authService.verifySessionQuery(queryMessage, querySig)).rejects.toThrow(
        AuthError,
      );

      try {
        await authService.verifySessionQuery(queryMessage, querySig);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.UNAUTHORIZED);
      }
    });

    it('expired grant cannot authorize', async () => {
      // Advance clock past grant expiry (1800s)
      currentTimestamp += 1801;

      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };

      const signature = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      let caughtError: any;
      try {
        await authService.verifySessionQuery(queryMessage, signature);
      } catch (err) {
        caughtError = err;
      }
      expect(caughtError).toBeInstanceOf(AuthError);
      expect(caughtError.code).toBe(ERROR_CODES.EXPIRED);

      // Once purged upon detecting expiry, subsequent query reports UNKNOWN_SESSION
      await expect(authService.verifySessionQuery(queryMessage, signature)).rejects.toThrow(
        AuthError,
      );
    });

    it('session key cannot authorize a mutation', async () => {
      const intentMessage: IntentMsg = {
        owner: alice.address,
        tokenIn: NATIVE,
        tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amountIn: 100000000000000000n,
        comparator: 0,
        triggerPrice: 3000n * 10n ** 18n,
        maxSlippageBps: 50,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 100),
      };

      // Attempt to sign intent using session key instead of primary owner wallet
      const signature = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'Intent',
        message: intentMessage,
      });

      await expect(
        authService.verifyAndAuthorizeMutation('Intent', intentMessage, signature),
      ).rejects.toThrow(AuthError);

      try {
        await authService.verifyAndAuthorizeMutation('Intent', intentMessage, signature);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.BAD_SIGNATURE);
      }
    });

    it('SessionQuery does not consume nonce', async () => {
      expect(ledger.getLastNonce(alice.address)).toBe(0n);

      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };

      const signature = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      await authService.verifySessionQuery(queryMessage, signature);

      // Nonce must remain unchanged
      expect(ledger.getLastNonce(alice.address)).toBe(0n);
    });

    it('replacement grant invalidates previous key', async () => {
      // Alice grants to sessionUser2, replacing sessionUser1
      const grantMessage2: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser2.address,
        expiry: BigInt(currentTimestamp + 1800),
      };
      const grantSig2 = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: grantMessage2,
      });
      await authService.createSessionGrant(grantMessage2, grantSig2);

      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };

      // sessionUser1 should now fail
      const sig1 = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });
      await expect(authService.verifySessionQuery(queryMessage, sig1)).rejects.toThrow(
        AuthError,
      );

      // sessionUser2 should succeed
      const sig2 = await sessionUser2.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });
      const res = await authService.verifySessionQuery(queryMessage, sig2);
      expect(res.sessionKey).toBe(getAddress(sessionUser2.address));
    });

    it('a rejected replacement grant does not invalidate or overwrite the existing valid grant', async () => {
      // Alice attempts to replace sessionUser1 with sessionUser2 using an expired grant
      const invalidGrantMessage: SessionGrantMsg = {
        owner: alice.address,
        sessionKey: sessionUser2.address,
        expiry: BigInt(currentTimestamp - 1),
      };
      const invalidGrantSig = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionGrant',
        message: invalidGrantMessage,
      });

      await expect(
        authService.createSessionGrant(invalidGrantMessage, invalidGrantSig),
      ).rejects.toThrow(AuthError);

      // Existing valid grant for sessionUser1 must remain intact and functional
      const queryMessage: SessionQueryMsg = {
        owner: alice.address,
        expiry: BigInt(currentTimestamp + 100),
      };
      const sig1 = await sessionUser1.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message: queryMessage,
      });

      const res = await authService.verifySessionQuery(queryMessage, sig1);
      expect(res.owner).toBe(getAddress(alice.address));
      expect(res.sessionKey).toBe(getAddress(sessionUser1.address));
    });
  });

  describe('Nonce Protection and Journal Ordering', () => {
    it('nonce accepted and journaled', async () => {
      expect(ledger.getLastNonce(alice.address)).toBe(0n);

      await authService.consumeNonce(alice.address, 1n);

      expect(ledger.getLastNonce(alice.address)).toBe(1n);

      // Verify journal entry
      const entries = [];
      for await (const entry of journal.replay()) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toEqual({
        t: 'NONCE_USED',
        owner: getAddress(alice.address),
        nonce: 1n,
      });
    });

    it('duplicate nonce rejected', async () => {
      await authService.consumeNonce(alice.address, 1n);

      await expect(authService.consumeNonce(alice.address, 1n)).rejects.toThrow(AuthError);

      try {
        await authService.consumeNonce(alice.address, 1n);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.NONCE_USED);
      }
    });

    it('lower nonce rejected', async () => {
      await authService.consumeNonce(alice.address, 5n);

      await expect(authService.consumeNonce(alice.address, 4n)).rejects.toThrow(AuthError);

      try {
        await authService.consumeNonce(alice.address, 4n);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.NONCE_USED);
      }
    });

    it('first nonce behavior documented (0 is rejected under current ledger semantics)', async () => {
      // In Cloakroom ledger, getLastNonce defaults to 0n and setNonce requires nonce > lastNonce.
      // Therefore, the first valid accepted nonce must be strictly > 0n (e.g. 1n).
      expect(ledger.getLastNonce(alice.address)).toBe(0n);

      await expect(authService.consumeNonce(alice.address, 0n)).rejects.toThrow(AuthError);

      try {
        await authService.consumeNonce(alice.address, 0n);
      } catch (err: any) {
        expect(err.code).toBe(ERROR_CODES.NONCE_USED);
      }

      // 1n succeeds
      await authService.consumeNonce(alice.address, 1n);
      expect(ledger.getLastNonce(alice.address)).toBe(1n);
    });

    it('journal append failure leaves ledger nonce unchanged', async () => {
      await authService.consumeNonce(alice.address, 1n);
      expect(ledger.getLastNonce(alice.address)).toBe(1n);

      // Force journal failure by closing file descriptor
      await journal.close();

      await expect(authService.consumeNonce(alice.address, 2n)).rejects.toThrow();

      // Ledger nonce must NOT have moved to 2n
      expect(ledger.getLastNonce(alice.address)).toBe(1n);
    });

    it('journal append failure does not poison queue', async () => {
      // Create failing journal wrapper
      let shouldFail = true;
      const failingJournal = {
        append: async (event: any) => {
          if (shouldFail) {
            throw new Error('DISK_IO_FAILURE');
          }
          return journal.append(event);
        },
      };

      const authWithFailingJournal = new AuthService({
        chainId,
        enclavePubKey: ENCLAVE_PUB_KEY,
        config: {
          sessionGrantTtlSec: 1800,
          maxExpiryFutureSec: 300,
          maxClockSkewSec: 60,
        },
        queue,
        journal: failingJournal,
        ledger,
        clock,
      });

      // Op 1 fails on journal append
      const op1 = authWithFailingJournal.consumeNonce(alice.address, 1n);
      await expect(op1).rejects.toThrow('DISK_IO_FAILURE');
      expect(ledger.getLastNonce(alice.address)).toBe(0n);

      // Op 2 should continue without being poisoned
      shouldFail = false;
      const op2 = authWithFailingJournal.consumeNonce(alice.address, 1n);
      await expect(op2).resolves.toBeUndefined();
      expect(ledger.getLastNonce(alice.address)).toBe(1n);
    });

    it('concurrent duplicate nonce: exactly one success', async () => {
      const op1 = authService.consumeNonce(alice.address, 10n);
      const op2 = authService.consumeNonce(alice.address, 10n);

      const results = await Promise.allSettled([op1, op2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(AuthError);
      expect(err.code).toBe(ERROR_CODES.NONCE_USED);

      expect(ledger.getLastNonce(alice.address)).toBe(10n);

      // Exactly one journal entry
      const entries = [];
      for await (const entry of journal.replay()) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toEqual({
        t: 'NONCE_USED',
        owner: getAddress(alice.address),
        nonce: 10n,
      });
    });

    it('same nonce for different owners is independently accepted', async () => {
      const opAlice = authService.consumeNonce(alice.address, 5n);
      const opBob = authService.consumeNonce(bob.address, 5n);

      await Promise.all([opAlice, opBob]);

      expect(ledger.getLastNonce(alice.address)).toBe(5n);
      expect(ledger.getLastNonce(bob.address)).toBe(5n);

      const entries = [];
      for await (const entry of journal.replay()) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.event)).toEqual([
        { t: 'NONCE_USED', owner: getAddress(alice.address), nonce: 5n },
        { t: 'NONCE_USED', owner: getAddress(bob.address), nonce: 5n },
      ]);
    });

    it('journal event contains the correct normalized owner and nonce', async () => {
      // Pass lowercase owner address
      const lowerOwner = alice.address.toLowerCase() as Address;
      await authService.consumeNonce(lowerOwner, 7n);

      const entries = [];
      for await (const entry of journal.replay()) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(1);
      expect(entries[0].event).toEqual({
        t: 'NONCE_USED',
        owner: getAddress(alice.address),
        nonce: 7n,
      });
    });
  });

  describe('Full Mutation Authorization Pipeline', () => {
    it('verifies owner signature, validates expiry, and consumes nonce in one pipeline', async () => {
      const message: IntentMsg = {
        owner: alice.address,
        tokenIn: NATIVE,
        tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amountIn: 500000000000000000n,
        comparator: 1,
        triggerPrice: 2500n * 10n ** 18n,
        maxSlippageBps: 100,
        nonce: 1n,
        expiry: BigInt(currentTimestamp + 120),
      };

      const signature = await alice.signTypedData({
        domain: authService.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'Intent',
        message,
      });

      const res = await authService.verifyAndAuthorizeMutation('Intent', message, signature);
      expect(res.owner).toBe(getAddress(alice.address));
      expect(res.nonce).toBe(1n);
      expect(ledger.getLastNonce(alice.address)).toBe(1n);

      // Replaying the same request fails with NONCE_USED
      await expect(
        authService.verifyAndAuthorizeMutation('Intent', message, signature),
      ).rejects.toThrow(AuthError);
    });
  });
});
