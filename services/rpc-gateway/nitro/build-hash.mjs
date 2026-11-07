import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';

async function files(directory) {
  return (await Promise.all((await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.name !== '__pycache__')
    .map((entry) => entry.isDirectory() ? files(`${directory}/${entry.name}`) : `${directory}/${entry.name}`))).flat();
}
const hash = createHash('sha256');
const config = process.env.RPC_CONFIG_SHA256;
if (config) {
  if (!/^[a-f0-9]{64}$/.test(config)) throw new Error('INVALID_CONFIG_HASH');
  hash.update(`config.sha256\0${config}\0`);
  await writeFile('dist/config.sha256', `${config}\n`);
} else await rm('dist/config.sha256', { force: true });
const paths = [...await files('src'), ...await files('nitro'), ...await files('../enclave/src'),
  ...await files('../enclave/nitro'), ...await files('../../packages/attestation/src'),
  'package.json', 'Dockerfile', '../../pnpm-lock.yaml'].sort();
for (const path of paths) {
  const bytes = await readFile(path); hash.update(`${path}\0${bytes.length}\0`).update(bytes);
}
await writeFile('dist/build-hash', `${hash.digest('hex')}\n`);
