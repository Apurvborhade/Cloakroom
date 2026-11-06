import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

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
for (const path of paths) {
  const bytes = await readFile(path);
  hash.update(`${path}\0${bytes.length}\0`).update(bytes);
}
await writeFile('dist/build-hash', `${hash.digest('hex')}\n`);
