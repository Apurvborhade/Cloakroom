import { createTransportSuite, decodeBase64, envelopeAad, HPKE_PARAMETERS } from '@cloakroom/shared';
import type { Envelope, EnvelopeContext } from '@cloakroom/shared';

/** Decrypts transport only; EIP-712 authorization and nonce consumption remain mandatory. */
export async function openEnvelope(
  privateKey: CryptoKey,
  envelope: Envelope,
  context: EnvelopeContext,
): Promise<unknown> {
  try {
    if (!envelope || Object.keys(envelope).sort().join(',') !== 'ct,enc') throw new Error();
    const enc = decodeBase64(envelope.enc, 32);
    const ciphertext = decodeBase64(envelope.ct, HPKE_PARAMETERS.maxPlaintextBytes + 16);
    if (enc.length !== 32 || ciphertext.length < 16) throw new Error();
    const recipient = await createTransportSuite().createRecipientContext({
      recipientKey: privateKey, enc, info: new TextEncoder().encode(HPKE_PARAMETERS.info),
    });
    const plaintext = await recipient.open(ciphertext, envelopeAad(context));
    if (plaintext.byteLength > HPKE_PARAMETERS.maxPlaintextBytes) throw new Error();
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error('INVALID_PAYLOAD');
  }
}
