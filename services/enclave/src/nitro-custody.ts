import type { Journal } from '@cloakroom/shared';
import { KeyManager } from './keys.js';
import type { SigningPolicy } from './keys.js';
import { createRecipientKms, NitroKmsSealingKey } from './kms-sealing.js';
import { AesGcmStateVault, RemoteCipherBlobStore } from './sealed-state.js';
import { parentRoleCredentials } from './parent-credentials.js';
import { openCustodyRuntime } from './custody-runtime.js';

type NitroOptions = {
  keyArn: string; region: string; vaultId: string;
  credentials?: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date }>;
  policy: SigningPolicy; allowCreate?: boolean;
};

function stores(options: NitroOptions) {
  if (!options.keyArn.startsWith(`arn:aws:kms:${options.region}:`)) throw new Error('INVALID_KMS_REGION');
  return {
    wrapping: new RemoteCipherBlobStore('\0cloakroom-storage', options.vaultId, 'wrapping'),
    custody: new RemoteCipherBlobStore('\0cloakroom-storage', options.vaultId, 'custody'),
    journal: new RemoteCipherBlobStore('\0cloakroom-storage', options.vaultId, 'journal'),
  };
}

function vault(options: NitroOptions, blobs: ReturnType<typeof stores>, allowCreate: boolean) {
  const kms = createRecipientKms({ region: options.region, relaySocket: '\0cloakroom-kms',
    credentials: options.credentials ?? parentRoleCredentials() });
  const provider = new NitroKmsSealingKey({ keyArn: options.keyArn, vaultId: options.vaultId,
    store: blobs.wrapping, kms, allowCreate });
  return new AesGcmStateVault(blobs.custody, provider);
}

/** Returns only after custody, journal, ledger and NSM attestation are ready. */
export async function openNitroRuntime(options: NitroOptions & { buildHash: string }) {
  const blobs = stores(options);
  const saved = await Promise.all([blobs.wrapping.read(), blobs.custody.read(), blobs.journal.read()]);
  const fresh = saved.every((value) => value === undefined);
  if (saved.some((value) => value === undefined) && !(fresh && options.allowCreate === true)) {
    throw new Error('CUSTODY_STATE_MISSING');
  }
  const allowCreate = fresh && options.allowCreate === true;
  return openCustodyRuntime({ vault: vault(options, blobs, allowCreate), journalStore: blobs.journal,
    policy: options.policy, buildHash: options.buildHash, allowCreate });
}

/** Real NSM + authenticated KMS TLS + external ciphertext. There is no simulation fallback. */
export async function openNitroCustody(options: NitroOptions & {
  journal: Pick<Journal, 'append' | 'replay'>;
}): Promise<KeyManager> {
  const keys = new KeyManager({ vault: vault(options, stores(options), options.allowCreate === true), journal: options.journal,
    policy: options.policy, allowCreate: options.allowCreate });
  await keys.init();
  return keys;
}
