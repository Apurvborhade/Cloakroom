import { request } from 'node:http';
import { z } from 'zod';

const CREDENTIALS = z.object({
  Code: z.literal('Success'), AccessKeyId: z.string().min(16).max(128),
  SecretAccessKey: z.string().min(16).max(256), Token: z.string().min(1).max(16_384),
  Expiration: z.string().datetime(),
});

/** Parent role credentials are not custody secrets. KMS still requires recipient attestation. */
export function parentRoleCredentials(socketPath = '\0cloakroom-storage') {
  let cached: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiresAt: number } | undefined;
  let pending: Promise<NonNullable<typeof cached>> | undefined;
  return async () => {
    if (cached && cached.expiresAt > Date.now() + 120_000) return cached;
    pending ??= new Promise<NonNullable<typeof cached>>((resolve, reject) => {
      const fail = () => reject(new Error('PARENT_CREDENTIALS_UNAVAILABLE'));
      const req = request({ socketPath, path: '/role-credentials', method: 'GET', agent: false }, (res) => {
        const parts: Buffer[] = []; let length = 0;
        res.on('data', (part: Buffer) => {
          length += part.length;
          if (length > 24_576) { res.destroy(); fail(); } else parts.push(part);
        });
        res.on('error', fail);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error();
            const value = CREDENTIALS.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
            const expiresAt = Date.parse(value.Expiration);
            if (expiresAt <= Date.now() + 120_000) throw new Error();
            resolve({ accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey,
              sessionToken: value.Token, expiresAt });
          } catch { fail(); }
        });
      });
      req.on('error', fail); req.setTimeout(5_000, () => { req.destroy(); fail(); }); req.end();
    });
    try { cached = await pending; return cached; }
    finally { pending = undefined; }
  };
}
