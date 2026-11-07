import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createDomain, deriveEnclaveSalt, EIP712_TYPES, ESCAPE_HATCH_ABI, escapeClaimId,
  NATIVE, sealEnvelopeWithResponse,
} from '@cloakroom/shared';
import {
  createPublicClient, createTestClient, createWalletClient, getAddress, http, parseEther,
  type Abi, type Address, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { loadConfig } from '../src/config.js';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import { bootEnclave, type RunningEnclave } from '../src/server.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from '../test/fixtures/test-token.js';

// Anvil's public test account; this script only starts and uses its own local chain.
const funder = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const owner = privateKeyToAccount(generatePrivateKey());
const session = privateKeyToAccount(generatePrivateKey());
const port = randomInt(20_000, 40_000), apiPort = port + 1;
const transport = http(`http://127.0.0.1:${port}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 20 });
const wallet = createWalletClient({ account: funder, chain: foundry, transport });
const ownerWallet = createWalletClient({ account: owner, chain: foundry, transport });
const testChain = createTestClient({ chain: foundry, mode: 'anvil', transport });
const baseUrl = `http://127.0.0.1:${apiPort}`;
const custodyStore = new MemoryCipherBlobStore(), journalStore = new MemoryCipherBlobStore();
const sealingKey = simulationSealingKey(randomBytes(32).toString('hex'), true);
const amount = parseEther('0.01'), timeout = 60n;
const defaults = Object.fromEntries((await readFile('.env.example', 'utf8')).split('\n')
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
let anvil: ChildProcess | undefined, enclave: RunningEnclave | undefined, token: Address;
let nonce = 0n;

async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(30);
  }
  throw new Error(message);
}

async function boot(hatch?: Address) {
  const config = loadConfig({
    ...defaults, ADMIN_ADDRESS: funder.address,
    CHAIN_ID: String(foundry.id), RPC_URL: `http://127.0.0.1:${port}`, CONFIRMATIONS: '0',
    SIM_MODE: 'true', CUSTODY_ALLOW_CREATE: 'true', SEEDING_ENABLED: 'false', MARGIN_ENABLED: 'false',
    ALLOWED_ORIGIN: 'http://localhost:3000', HOST: '127.0.0.1', PORT: String(apiPort),
    UNISWAP_API_KEY: 'local-test', TOKEN_OUT_ADDRESS: token, INVENTORY_EOA_COUNT: '2',
    PRICE_POLL_INTERVAL_SEC: '3600', RECEIPT_TIMEOUT_MS: '1000',
    ...(hatch ? { ESCAPE_HATCH_ADDRESS: hatch } : {}),
  });
  enclave = await bootEnclave({
    config, chain,
    quoter: { async quote(request) { return { amountIn: request.amountIn, amountOut: 1n, minAmountOut: 1n }; } },
    openRuntime: (policy) => openCustodyRuntime({
      vault: new AesGcmStateVault(custodyStore, sealingKey, true), journalStore, policy,
      simMode: true, allowCreate: true, buildHash: 'ab'.repeat(32), quote: async () => Buffer.from('simulation'),
    }),
  });
}

async function post(path: string, payload: unknown) {
  const { envelope, openResponse } = await sealEnvelopeWithResponse(payload, {
    path, chainId: foundry.id, enclavePubKey: enclave!.parts.keys.transportPublicKey(),
  });
  const response = await fetch(baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  const body = await response.json();
  return { status: response.status, body: response.status === 200 ? await openResponse(body) as any : body };
}

async function signed(path: string, primaryType: keyof typeof EIP712_TYPES, values: Record<string, unknown>, mutation = true, account = owner, extra: Record<string, unknown> = {}) {
  const message = { owner: owner.address, ...values, ...(mutation ? { nonce: ++nonce } : {}),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 120) };
  const signature = await account.signTypedData({
    domain: createDomain(foundry.id, deriveEnclaveSalt(enclave!.parts.keys.transportPublicKey())),
    types: EIP712_TYPES, primaryType, message: message as never,
  });
  const wire = JSON.parse(JSON.stringify(message, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  return post(path, { message: wire, signature, ...extra });
}

async function grant() {
  const result = await signed('/session', 'SessionGrant', { sessionKey: session.address }, false);
  assert.equal(result.status, 200);
}
const status = () => signed('/escape/status', 'SessionQuery', {}, false, session);
const read = <T>(hatch: Address, functionName: string, args: unknown[] = []) =>
  chain.readContract({ address: hatch, abi: ESCAPE_HATCH_ABI, functionName, args } as never) as Promise<T>;

try {
  execFileSync(process.env.FORGE_BIN ?? 'forge', ['build', '--root', 'contracts'], { stdio: 'pipe' });
  const artifact = JSON.parse(await readFile('contracts/out/EscapeHatch.sol/EscapeHatch.json', 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  anvil = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
  await until(async () => { try { await chain.getBlockNumber(); return true; } catch { return false; } }, 'Anvil unavailable');
  const deployedToken = await wallet.deployContract({ abi: TEST_TOKEN_ABI, bytecode: TEST_TOKEN_BYTECODE });
  token = (await chain.waitForTransactionReceipt({ hash: deployedToken })).contractAddress!;
  await boot();
  const identity = await (await fetch(baseUrl + '/escape/identity')).json() as { escapeSigner: Address; enabled: boolean; unverified: boolean };
  assert.equal(identity.enabled, false);
  assert.equal(identity.unverified, true);
  const custodyIdentity = enclave!.parts.keys.transportPublicKey();
  const custodyAddresses = enclave!.parts.keys.list().map((entry) => entry.address);
  await enclave!.stop();
  const deployment = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object,
    args: [identity.escapeSigner, timeout] });
  const hatch = (await chain.waitForTransactionReceipt({ hash: deployment })).contractAddress!;
  for (const [to, value] of [[hatch, amount], [identity.escapeSigner, parseEther('0.1')], [owner.address, parseEther('0.1')]] as const) {
    await chain.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to, value }) });
  }
  await boot(hatch);
  assert.equal(enclave!.parts.keys.transportPublicKey(), custodyIdentity);
  assert.deepEqual(enclave!.parts.keys.list().map((entry) => entry.address), custodyAddresses);
  const quote = await (await fetch(baseUrl + '/attestation')).json() as { escapeSigner: Address };
  assert.equal(getAddress(quote.escapeSigner), getAddress(identity.escapeSigner));
  const deposit = await signed('/deposit-session', 'DepositRequest', { asset: NATIVE });
  assert.equal(deposit.status, 200);
  await chain.waitForTransactionReceipt({ hash: await wallet.sendTransaction({
    to: deposit.body.depositAddress, value: amount + BigInt(deposit.body.gasReserveWei),
  }) });
  await until(async () => {
    await enclave!.parts.watcher.tick();
    return enclave!.parts.ledger.getBalance(owner.address, NATIVE).available === amount;
  }, 'Deposit not credited');
  assert.equal(enclave!.parts.watcher.getSession(deposit.body.sessionId)?.open, false);
  const code = `0x${randomBytes(32).toString('hex')}` as Hex;
  const claimId = escapeClaimId(foundry.id, hatch, owner.address, code);
  const onchainId = await chain.readContract({ address: hatch, abi: artifact.abi, functionName: 'claimId', args: [owner.address, code] });
  assert.equal(onchainId, claimId);
  assert.equal((await signed('/escape/activate', 'EscapeActivate', { hatch, claimId, amount }, true, owner, { code })).status, 200);
  await grant();
  await until(async () => (await status()).body.claim?.status === 'registered', 'Claim not registered');
  assert.equal(await read<bigint>(hatch, 'claims', [claimId]), amount);
  assert.equal(enclave!.parts.ledger.getBalance(owner.address, NATIVE).available, 0n);
  assert.equal(enclave!.parts.ledger.getBalance(owner.address, NATIVE).reserved, amount);
  const withdrawal = await signed('/withdrawals', 'Withdrawal', { token: NATIVE, amount, to: owner.address });
  assert.notEqual(withdrawal.status, 200);
  assert.equal(withdrawal.body.error, 'INSUFFICIENT_BALANCE');
  await enclave!.stop();
  await boot(hatch);
  await grant();
  assert.equal((await status()).body.claim.status, 'registered');
  assert.equal(enclave!.parts.ledger.getBalance(owner.address, NATIVE).reserved, amount);
  await enclave!.stop();
  enclave = undefined;
  const lastHeartbeat = await read<bigint>(hatch, 'lastHeartbeat');
  await testChain.setNextBlockTimestamp({ timestamp: lastHeartbeat + timeout + 1n });
  await testChain.mine({ blocks: 1 });
  assert.equal(await read<boolean>(hatch, 'expired'), true);
  const before = await chain.getBalance({ address: owner.address });
  const claimTx = await ownerWallet.writeContract({ address: hatch, abi: ESCAPE_HATCH_ABI, functionName: 'claim', args: [code] });
  const receipt = await chain.waitForTransactionReceipt({ hash: claimTx });
  assert.equal(receipt.status, 'success');
  assert.equal(await chain.getBalance({ address: owner.address }) - before + receipt.gasUsed * receipt.effectiveGasPrice, amount);
  assert.equal(await read<bigint>(hatch, 'claims', [claimId]), 0n);
  await boot(hatch);
  await grant();
  await until(async () => (await status()).body.claim?.status === 'claimed', 'External claim not recovered');
  assert.equal(enclave!.parts.ledger.getBalance(owner.address, NATIVE).available, 0n);
  assert.equal(enclave!.parts.ledger.getBalance(owner.address, NATIVE).reserved, 0n);
  assert.equal(await read<bigint>(hatch, 'lastHeartbeat'), lastHeartbeat);
  enclave!.parts.ledger.assertInvariants();
  console.log('PASS: deposit, registration, locked funds, restart, outage claim and claim recovery on Anvil.');
  console.log('SIM_MODE only; no Nitro attestation or public-chain deployment tested.');
} finally {
  try { await enclave?.stop(); }
  finally { anvil?.kill(); }
}
