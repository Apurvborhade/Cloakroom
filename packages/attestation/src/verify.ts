import { decode, encode } from 'cborg';
import { Certificate, CertificateChainValidationEngine, CryptoEngine } from 'pkijs';
import { NITRO_ROOT_PEM } from './root.js';

export interface TrustedRelease {
  buildHash: string;
  chainId: number;
  measurements: { PCR0: string; PCR1: string; PCR2: string };
}
export interface CustodyAttestation {
  quote: string; buildHash: string; chainId: number; enclavePubKey: string; escapeSigner?: string;
}
export interface RpcAttestation {
  quote: string; buildHash: string; chainId: number; tlsSpkiSha256: string;
}

function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`ATTESTATION_${message}`);
}
export function hexBytes(value: string, length: number): Uint8Array<ArrayBuffer> {
  requireValue(typeof value === 'string', 'INVALID_HEX');
  const text = value.replace(/^0x/, '');
  requireValue(text.length === length * 2 && /^[a-f0-9]+$/i.test(text), 'INVALID_HEX');
  return Uint8Array.from(text.match(/../g)!, (byte) => parseInt(byte, 16));
}
function base64(value: string): Uint8Array<ArrayBuffer> {
  requireValue(typeof value === 'string' && value.length <= 87_384
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'INVALID_BASE64');
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  requireValue(value instanceof Uint8Array, 'INVALID_BYTES');
  return new Uint8Array(value);
}
function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
function map(value: unknown): Map<unknown, unknown> {
  requireValue(value instanceof Map, 'INVALID_MAP');
  return value;
}
function cbor(value: Uint8Array): unknown {
  return decode(value, { useMaps: true, rejectDuplicateMapKeys: true, allowIndefinite: true,
    allowNaN: false, allowInfinity: false, allowUndefined: false, strictUtf8: true,
    tags: { 18: (decode) => decode() } });
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const utf8 = (text: string) => new TextEncoder().encode(text);
const sha256 = async (value: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', value));

function certificate(der: Uint8Array): Certificate {
  requireValue(der.length > 0 && der.length <= 4096, 'INVALID_CERTIFICATE');
  return Certificate.fromBER(new Uint8Array(der).buffer);
}

// The alternate root is used only by synthetic PKI tests, never sourced from a response.
export async function verifyDocument(quote: string, expected: {
  nonce: Uint8Array; publicKey: Uint8Array; binding: Uint8Array;
  measurements: TrustedRelease['measurements']; now: number;
}, rootPem = NITRO_ROOT_PEM): Promise<void> {
  const raw = base64(quote);
  requireValue(raw.length > 0 && raw.length <= 65_536, 'INVALID_QUOTE');
  const cose = cbor(raw);
  requireValue(Array.isArray(cose) && cose.length === 4, 'INVALID_COSE');
  const protectedBytes = bytes(cose[0]), payload = bytes(cose[2]), signature = bytes(cose[3]);
  const protectedHeader = map(cbor(protectedBytes));
  requireValue(protectedHeader.size === 1 && protectedHeader.get(1) === -35
    && map(cose[1]).size === 0 && signature.length === 96, 'INVALID_COSE_HEADER');
  const document = map(cbor(payload));
  requireValue(document.get('digest') === 'SHA384', 'INVALID_DIGEST');
  const timestamp = document.get('timestamp');
  requireValue(typeof timestamp === 'number' && Number.isSafeInteger(timestamp)
    && timestamp >= expected.now - 300_000 && timestamp <= expected.now + 30_000, 'STALE');
  requireValue(expected.nonce.length >= 32 && expected.nonce.length <= 64
    && equal(bytes(document.get('nonce')), expected.nonce), 'NONCE_MISMATCH');
  requireValue(equal(bytes(document.get('public_key')), expected.publicKey), 'KEY_MISMATCH');
  requireValue(equal(bytes(document.get('user_data')), expected.binding), 'BINDING_MISMATCH');
  const pcrs = map(document.get('pcrs'));
  for (const index of [0, 1, 2] as const) {
    const trusted = hexBytes(expected.measurements[`PCR${index}`], 48);
    requireValue(trusted.some((byte) => byte !== 0) && equal(bytes(pcrs.get(index)), trusted), 'PCR_MISMATCH');
  }
  const bundle = document.get('cabundle');
  requireValue(Array.isArray(bundle) && bundle.length > 0 && bundle.length <= 8, 'INVALID_CERTIFICATE_CHAIN');
  const root = certificate(base64(rootPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')));
  const leaf = certificate(bytes(document.get('certificate')));
  const intermediates = bundle.map((item) => certificate(bytes(item)));
  const engine = new CryptoEngine({ name: 'WebCrypto', crypto: globalThis.crypto });
  const chain = await new CertificateChainValidationEngine({
    trustedCerts: [root], certs: [...intermediates, leaf], checkDate: new Date(expected.now),
  }).verify({ passedWhenNotRevValues: true }, engine);
  requireValue(chain.result, 'INVALID_CERTIFICATE_CHAIN');
  const key = await crypto.subtle.importKey('spki', new Uint8Array(leaf.subjectPublicKeyInfo.toSchema().toBER(false)),
    { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
  const signed = new Uint8Array(encode(['Signature1', protectedBytes, new Uint8Array(), payload]));
  requireValue(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, key, signature, signed), 'INVALID_SIGNATURE');
}

function checkRelease(response: { buildHash: string; chainId: number }, release: TrustedRelease) {
  requireValue(Number.isSafeInteger(release.chainId) && release.chainId > 0
    && response.chainId === release.chainId, 'CHAIN_MISMATCH');
  requireValue(equal(hexBytes(response.buildHash, 32), hexBytes(release.buildHash, 32)), 'BUILD_MISMATCH');
}

export async function verifyCustodyAttestation(response: CustodyAttestation, options: {
  release: TrustedRelease; nonce: string; escapeSigner?: string; now?: number;
}) {
  checkRelease(response, options.release);
  const publicKey = hexBytes(response.enclavePubKey, 32), build = hexBytes(options.release.buildHash, 32);
  let binding = concat(publicKey, build);
  if (response.escapeSigner !== undefined) {
    const signer = hexBytes(response.escapeSigner, 20);
    requireValue(signer.some((byte) => byte !== 0), 'INVALID_SIGNER');
    binding = concat(utf8('cloakroom/attestation/escape/v1\0'), binding, signer);
  }
  if (options.escapeSigner !== undefined) requireValue(response.escapeSigner !== undefined
    && equal(hexBytes(options.escapeSigner, 20), hexBytes(response.escapeSigner, 20)), 'SIGNER_MISMATCH');
  await verifyDocument(response.quote, { nonce: hexBytes(options.nonce, 32), publicKey,
    binding: await sha256(binding), measurements: options.release.measurements, now: options.now ?? Date.now() });
  return { verified: true as const, enclavePubKey: response.enclavePubKey,
    ...(response.escapeSigner ? { escapeSigner: response.escapeSigner } : {}) };
}

export async function rpcBinding(tlsSpkiSha256: string, buildHash: string, chainId: number) {
  requireValue(Number.isSafeInteger(chainId) && chainId > 0, 'INVALID_CHAIN');
  const chain = new Uint8Array(8);
  new DataView(chain.buffer).setBigUint64(0, BigInt(chainId));
  return sha256(concat(utf8('cloakroom/attestation/rpc/v1\0'), hexBytes(tlsSpkiSha256, 32), hexBytes(buildHash, 32), chain));
}

export async function verifyRpcAttestation(response: RpcAttestation, options: {
  release: TrustedRelease; nonce: string; expectedTlsSpkiSha256: string; now?: number;
}) {
  checkRelease(response, options.release);
  requireValue(equal(hexBytes(response.tlsSpkiSha256, 32), hexBytes(options.expectedTlsSpkiSha256, 32)), 'TLS_KEY_MISMATCH');
  await verifyDocument(response.quote, { nonce: hexBytes(options.nonce, 32), publicKey: hexBytes(response.tlsSpkiSha256, 32),
    binding: await rpcBinding(response.tlsSpkiSha256, options.release.buildHash, options.release.chainId),
    measurements: options.release.measurements, now: options.now ?? Date.now() });
  return { verified: true as const, tlsSpkiSha256: response.tlsSpkiSha256 };
}
