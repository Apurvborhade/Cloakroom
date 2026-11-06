import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createTransportSuite } from '../packages/shared/dist/index.js';

const { openEnvelope } = await import(pathToFileURL(resolve('services/enclave/dist/envelope.js')).href);
const { openEnvelopeWithResponse } = await import(pathToFileURL(resolve('services/enclave/dist/envelope.js')).href);
const { outputFiles } = await build({
  stdin: {
    contents: `import { sealEnvelope, sealEnvelopeWithResponse } from './packages/shared/src/transport.ts';
      globalThis.sealEnvelope = sealEnvelope; globalThis.sealEnvelopeWithResponse = sealEnvelopeWithResponse;`,
    resolveDir: process.cwd(), sourcefile: 'transport-browser-check.js',
  },
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022', write: false,
});
const script = outputFiles[0].text;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/bundle.js' ? script : '<!doctype html><script src="/bundle.js"></script>');
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const address = server.address();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.waitForFunction(() => typeof globalThis.sealEnvelope === 'function');
  const suite = createTransportSuite();
  const keys = await suite.kem.generateKeyPair();
  const publicBytes = await suite.kem.serializePublicKey(keys.publicKey);
  const context = { chainId: 11155111, path: '/balance', enclavePubKey: `0x${Buffer.from(publicBytes).toString('hex')}` };
  const result = await page.evaluate(async (context) => ({
    nodeBufferPresent: typeof globalThis.Buffer !== 'undefined',
    envelopes: await Promise.all(Array.from({ length: 16 }, (_, sequence) =>
      globalThis.sealEnvelope({ sequence, message: 'browser transport check' }, context))),
  }), context);
  assert.equal(result.nodeBufferPresent, false);
  assert.equal(new Set(result.envelopes.map((item) => item.enc)).size, 16);
  for (const [sequence, envelope] of result.envelopes.entries()) {
    assert.deepEqual(await openEnvelope(keys.privateKey, envelope, context),
      { sequence, message: 'browser transport check' });
    await assert.rejects(openEnvelope(keys.privateKey, envelope, { ...context, path: '/withdrawals' }));
  }
  const envelope = await page.evaluate(async (context) => {
    globalThis.pending = await globalThis.sealEnvelopeWithResponse({ check: 'response' }, context);
    return globalThis.pending.envelope;
  }, context);
  const recipient = await openEnvelopeWithResponse(keys.privateKey, envelope, context);
  assert.deepEqual(recipient.payload, { check: 'response' });
  const response = await recipient.sealResponse({ authenticated: true });
  assert.deepEqual(await page.evaluate((response) => globalThis.pending.openResponse(response), response), { authenticated: true });
  console.log(JSON.stringify({ ok: true, browser: 'Chromium', concurrentMessages: 16,
    wrongRouteRejected: true, authenticatedResponse: true }));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
