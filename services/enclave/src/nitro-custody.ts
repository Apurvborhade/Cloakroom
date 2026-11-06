import type { Journal } from '@cloakroom/shared';
import { KeyManager } from './keys.js';
import type { SigningPolicy } from './keys.js';
import { createRecipientKms, NitroKmsSealingKey } from './kms-sealing.js';
import { AesGcmStateVault, RemoteCipherBlobStore } from './sealed-state.js';
import { parentRoleCredentials } from './parent-credentials.js';

/** Real NSM + authenticated KMS TLS + external ciphertext. There is no simulation fallback. */
export async function openNitroCustody(options: {
  keyArn: string; region: string; vaultId: string;
  credentials?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date }>;
  journal: Pick<Journal, 'append' | 'replay'>; policy: SigningPolicy;
  allowCreate?: boolean;
}): Promise<KeyManager> {
  if (!options.keyArn.startsWith(`arn:aws:kms:${options.region}:`)) throw new Error('INVALID_KMS_REGION');
  const wrapping = new RemoteCipherBlobStore('\0cloakroom-storage', options.vaultId, 'wrapping');
  const custody = new RemoteCipherBlobStore('\0cloakroom-storage', options.vaultId, 'custody');
  const kms = createRecipientKms({ region: options.region, relaySocket: '\0cloakroom-kms',
    credentials: options.credentials ?? parentRoleCredentials() });
  const provider = new NitroKmsSealingKey({ keyArn: options.keyArn, vaultId: options.vaultId,
    store: wrapping, kms, allowCreate: options.allowCreate });
  const keys = new KeyManager({ vault: new AesGcmStateVault(custody, provider), journal: options.journal,
    policy: options.policy, allowCreate: options.allowCreate });
  await keys.init();
  return keys;
}
