import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'vitest';
import { AttestationResponseSchema } from '@cloakroom/shared';
import { AttestationService, type QuoteProvider } from '../src/attestation.js';

const buildHash = 'ab'.repeat(32);

test('binds an enclave-generated X25519 key and the build hash into the quote', async () => {
  const nonce = randomBytes(32);
  const requests: Parameters<QuoteProvider>[0][] = [];
  const service = new AttestationService(buildHash, async (input) => {
    requests.push(input);
    return Buffer.from('signed document');
  });
  const response = await service.response(nonce);
  const request = requests[0]!;
  assert.deepEqual(Object.keys(response).sort(), ['buildHash', 'chainId', 'enclavePubKey', 'quote']);
  assert.equal(response.chainId, 11155111);
  assert.equal(response.buildHash, `0x${buildHash}`);
  AttestationResponseSchema.parse(response);
  assert.equal(Buffer.from(response.enclavePubKey.slice(2), 'hex').length, 32);
  assert.deepEqual(request.publicKey, Buffer.from(response.enclavePubKey.slice(2), 'hex'));
  assert.deepEqual(request.nonce, nonce);
  assert.deepEqual(request.userData, createHash('sha256')
    .update(request.publicKey).update(Buffer.from(buildHash, 'hex')).digest());
});

test('keeps the transport key for one boot and rotates it for a new boot', async () => {
  const provider = async () => Buffer.from('quote');
  const first = new AttestationService(buildHash, provider);
  const second = new AttestationService(buildHash, provider);
  assert.equal((await first.response()).enclavePubKey, (await first.response()).enclavePubKey);
  assert.notEqual((await first.response()).enclavePubKey, (await second.response()).enclavePubKey);
});

test('does not return simulated attestation when NSM fails', async () => {
  const service = new AttestationService(buildHash, async () => { throw new Error('No NSM'); });
  await assert.rejects(service.response(), /No NSM/);
});

test('rejects invalid build hashes and challenge lengths', async () => {
  assert.throws(() => new AttestationService('untrusted'), /Invalid build hash/);
  const service = new AttestationService(buildHash, async () => Buffer.from('quote'));
  await assert.rejects(service.response(Buffer.alloc(31)), /Invalid nonce/);
  await assert.rejects(service.response(Buffer.alloc(65)), /Invalid nonce/);
});
