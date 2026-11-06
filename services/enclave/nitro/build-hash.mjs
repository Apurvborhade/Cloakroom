import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter((entry) => entry.name !== '__pycache__')
    .map((entry) => entry.isDirectory()
    ? files(`${directory}/${entry.name}`) : `${directory}/${entry.name}`))).flat();
}

const paths = [...await files('src'), ...await files('nitro'), ...await files('../../packages/shared/src'), 'Dockerfile',
  'package.json', 'tsconfig.json', '../../packages/shared/package.json',
  '../../packages/shared/tsconfig.json', '../../tsconfig.base.json', '../../pnpm-lock.yaml'].sort();
const hash = createHash('sha256');
const configHash = process.env.NITRO_CONFIG_SHA256;
if (configHash) {
  if (!/^[a-f0-9]{64}$/.test(configHash)) throw new Error('INVALID_CONFIG_HASH');
  hash.update(`config.sha256\0${configHash}\0`);
  await writeFile('dist/config.sha256', `${configHash}\n`);
} else {
  await rm('dist/config.sha256', { force: true });
}
for (const path of paths) {
  const bytes = await readFile(path);
  hash.update(`${path}\0${bytes.length}\0`).update(bytes);
}
await writeFile('dist/build-hash', `${hash.digest('hex')}\n`);
