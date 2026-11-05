// Executed under Linux flock. Receives authenticated ciphertext, never key material.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const [path, expected] = process.argv.slice(2);
let temporary;
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error();
    chunks.push(chunk);
  }
  let previous;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error();
      previous = await file.readFile();
    } finally { await file.close(); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const hash = previous ? createHash('sha256').update(previous).digest('hex') : '-';
  if (hash !== expected) process.exitCode = 74;
  else {
    temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(Buffer.concat(chunks)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const parent = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
  }
} catch { process.exitCode = 75; }
finally { if (temporary) await unlink(temporary).catch(() => undefined); }
