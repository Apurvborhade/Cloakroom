/**
 * Two users deposit, then each withdraws to a fresh wallet, through the running service. It acts as
 * a browser does: it signs each request and encrypts it to the service's key.
 *
 * Refuses to run anywhere except Sepolia or a local Anvil chain, and only against a service in
 * simulation mode. See scripts/README.md.
 */
import {
  createDomain,
  deriveEnclaveSalt,
  EIP712_TYPES,
  NATIVE,
  sealEnvelopeWithResponse,
} from '@cloakroom/shared';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';

const CHAINS = { [sepolia.id]: sepolia, [foundry.id]: foundry } as const;
const EXPLORERS: Record<number, string> = { [sepolia.id]: 'https://sepolia.etherscan.io/tx/' };
const DEPOSIT = parseEther('0.02');
const PAYOUT = parseEther('0.003');
const REQUEST_LIFETIME_SEC = 120;
const SESSION_GRANT_MARGIN_SEC = 60;
const POLL_MS = Number(process.env.ROUNDTRIP_POLL_MS ?? 10_000);
const CREDIT_TIMEOUT_MS = 5 * 60_000;
const PAYOUT_TIMEOUT_MS = 5 * 60_000;
const SESSION_GRACE_MS = 5 * 60_000;
const SECRET_NAMES = ['RPC_URL', 'TEST_PRIVATE_KEY'];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

function describeError(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const name of SECRET_NAMES) {
    const secret = process.env[name];
    if (secret) text = text.replaceAll(secret, `[${name}]`);
  }
  return text;
}

let failures = 0;
function check(name: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const expiry = () => Math.floor(Date.now() / 1000) + REQUEST_LIFETIME_SEC;

async function waitFor<T>(what: string, timeoutMs: number, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

type Reply = { status: number; body: Record<string, unknown> };

/** Nonces only ever increase, so a clock-based one also works across repeat runs. */
let lastNonce = 0n;
function nextNonce(): bigint {
  lastNonce = BigInt(Date.now()) > lastNonce ? BigInt(Date.now()) : lastNonce + 1n;
  return lastNonce;
}

async function main(): Promise<void> {
  const testKey = required('TEST_PRIVATE_KEY') as Hex;
  const baseUrl = `http://${required('HOST')}:${required('PORT')}`;
  const transport = http(required('RPC_URL'));
  const chainId = await createPublicClient({ transport }).getChainId();
  if (!(chainId in CHAINS)) throw new Error(`Refusing to run on chain ${chainId}. Only Sepolia or Anvil.`);
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  const client = createPublicClient({ chain, transport, cacheTime: 0 });
  const funder = privateKeyToAccount(testKey);
  const wallet = createWalletClient({ account: funder, chain, transport });

  const derive = (label: string) => keccak256(concatHex([testKey, toHex(`roundtrip:${label}`)]));
  const alice = privateKeyToAccount(derive('alice'));
  const bob = privateKeyToAccount(derive('bob'));

  const keyResponse = await fetch(`${baseUrl}/sim/enclave-key`).catch(() => undefined);
  if (!keyResponse) throw new Error(`No service at ${baseUrl}. Start it with: pnpm start:enclave`);
  if (!keyResponse.ok) throw new Error('The service is not in simulation mode. Set SIM_MODE=true.');
  const { enclavePubKey, chainId: serviceChain } = (await keyResponse.json()) as { enclavePubKey: Hex; chainId: number };
  if (serviceChain !== chainId) throw new Error(`The service is on chain ${serviceChain}, and RPC_URL is on ${chainId}.`);
  const domain = createDomain(chainId, deriveEnclaveSalt(enclavePubKey));

  const post = async (path: string, payload: unknown): Promise<Reply> => {
    const { envelope, openResponse } = await sealEnvelopeWithResponse(payload, { path, chainId, enclavePubKey });
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const body = await response.json();
    return {
      status: response.status,
      body: response.ok ? ((await openResponse(body)) as Record<string, unknown>) : (body as Record<string, unknown>),
    };
  };
  const must = (reply: Reply, what: string) => {
    if (reply.status !== 200) throw new Error(`${what} was refused: ${String(reply.body.error)}`);
    return reply.body;
  };

  const sessionKeys = new Map<Address, PrivateKeyAccount>();
  const openSession = async (user: PrivateKeyAccount) => {
    const sessionKey = privateKeyToAccount(generatePrivateKey());
    // Lasts the whole run, unlike a single request: reads continue after deposit sessions end.
    const expires = Math.floor(Date.now() / 1000) + Number(required('SESSION_GRANT_TTL_SEC')) - SESSION_GRANT_MARGIN_SEC;
    const signature = await user.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'SessionGrant',
      message: { owner: user.address, sessionKey: sessionKey.address, expiry: BigInt(expires) },
    });
    must(
      await post('/session', {
        message: { owner: user.address, sessionKey: sessionKey.address, expiry: String(expires) },
        signature,
      }),
      'The session',
    );
    sessionKeys.set(user.address, sessionKey);
  };
  const read = async (path: string, user: PrivateKeyAccount) => {
    const expires = expiry();
    const signature = await sessionKeys.get(user.address)!.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'SessionQuery',
      message: { owner: user.address, expiry: BigInt(expires) },
    });
    return must(await post(path, { message: { owner: user.address, expiry: String(expires) }, signature }), path);
  };
  const available = async (user: PrivateKeyAccount) => {
    const { balances } = await read('/balance', user);
    const native = (balances as Array<{ token: Address; available: string }>).find(({ token }) => token === NATIVE);
    return BigInt(native?.available ?? 0);
  };

  const startDeposit = async (user: PrivateKeyAccount) => {
    const nonce = nextNonce();
    const expires = expiry();
    const signature = await user.signTypedData({
      domain,
      types: EIP712_TYPES,
      primaryType: 'DepositRequest',
      message: { owner: user.address, asset: NATIVE, nonce, expiry: BigInt(expires) },
    });
    const body = must(
      await post('/deposit-session', {
        message: { owner: user.address, asset: NATIVE, nonce: String(nonce), expiry: String(expires) },
        signature,
      }),
      'The deposit session',
    );
    return { address: getAddress(body.depositAddress as string), expiresAt: body.expiresAt as number };
  };

  const withdraw = async (user: PrivateKeyAccount, to: Address) => {
    const nonce = nextNonce();
    const expires = expiry();
    const message = { owner: user.address, token: NATIVE, amount: PAYOUT, to, nonce, expiry: BigInt(expires) };
    const signature = await user.signTypedData({ domain, types: EIP712_TYPES, primaryType: 'Withdrawal', message });
    return post('/withdrawals', {
      message: { ...message, amount: String(PAYOUT), nonce: String(nonce), expiry: String(expires) },
      signature,
    });
  };

  const needed = DEPOSIT * 2n;
  const startBalance = await client.getBalance({ address: funder.address });
  console.log(`Chain: ${chain.name} (${chainId}). Service: ${baseUrl}, TEE-simulated.`);
  console.log(`Test wallet: ${funder.address}, holding ${formatEther(startBalance)} ETH`);
  if (startBalance < needed + parseEther('0.005')) throw new Error(`The test wallet needs more than ${formatEther(needed)} ETH`);

  const users = [
    { name: 'Alice', account: alice, wallet: privateKeyToAccount(generatePrivateKey()).address },
    { name: 'Bob', account: bob, wallet: privateKeyToAccount(generatePrivateKey()).address },
  ];

  console.log('\n1. Open sessions');
  const before = new Map<Address, bigint>();
  for (const user of users) {
    await openSession(user.account);
    before.set(user.account.address, await available(user.account));
  }
  console.log('  Done');

  console.log('\n2. Deposit');
  const deposits = new Map<Address, Address>();
  let lastExpiry = 0;
  for (const user of users) {
    const session = await startDeposit(user.account);
    deposits.set(user.account.address, session.address);
    lastExpiry = Math.max(lastExpiry, session.expiresAt);
    const hash = await wallet.sendTransaction({ to: session.address, value: DEPOSIT });
    await client.waitForTransactionReceipt({ hash });
    console.log(`  ${user.name} sent ${formatEther(DEPOSIT)} ETH to ${session.address}`);
  }

  console.log('\n3. Wait for the service to credit the deposits');
  for (const user of users) {
    const credited = await waitFor(`${user.name}'s deposit to be credited`, CREDIT_TIMEOUT_MS, async () => {
      const balance = await available(user.account);
      return balance >= before.get(user.account.address)! + DEPOSIT ? balance : undefined;
    });
    check(`${user.name} is credited`, credited === before.get(user.account.address)! + DEPOSIT, `${formatEther(credited)} ETH`);
  }

  const secondsLeft = Math.max(0, lastExpiry - Math.floor(Date.now() / 1000));
  console.log(`\n4. Wait about ${secondsLeft}s for deposit sessions to end, so those addresses join the pool`);
  const payoutDeadline = lastExpiry * 1000 + SESSION_GRACE_MS;

  console.log('\n5. Withdraw to fresh wallets');
  const outcomes: Array<{ name: string; id: string; account: PrivateKeyAccount; wallet: Address }> = [];
  for (const user of users) {
    const reply = await waitFor(`an address that can pay ${user.name}`, payoutDeadline - Date.now(), async () => {
      const attempt = await withdraw(user.account, user.wallet);
      if (attempt.status === 200) return attempt;
      if (attempt.body.error === 'NO_INVENTORY') return undefined;
      throw new Error(`${user.name}'s withdrawal was refused: ${String(attempt.body.error)}`);
    });
    outcomes.push({ name: user.name, id: reply.body.withdrawalId as string, account: user.account, wallet: user.wallet });
    console.log(`  ${user.name}'s withdrawal is locked`);
  }

  console.log('\n6. Check the payouts');
  for (const outcome of outcomes) {
    const final = await waitFor(`${outcome.name}'s payout`, PAYOUT_TIMEOUT_MS, async () => {
      const { withdrawals } = await read('/withdrawals/status', outcome.account);
      const item = (withdrawals as Array<{ id: string; status: string; txHash?: Hex; reason?: string }>).find(
        ({ id }) => id === outcome.id,
      );
      return item && (item.status === 'confirmed' || item.status === 'failed') ? item : undefined;
    });
    check(`${outcome.name}'s payout is confirmed`, final.status === 'confirmed', final.reason ?? '');
    if (!final.txHash) continue;
    const transaction = await client.getTransaction({ hash: final.txHash });
    const ownDeposit = deposits.get(outcome.account.address);
    check(`${outcome.name} was not paid from their own deposit address`, getAddress(transaction.from) !== ownDeposit, transaction.from);
    check(`${outcome.name}'s fresh wallet received it`, (await client.getBalance({ address: outcome.wallet })) === PAYOUT, outcome.wallet);
    if (EXPLORERS[chainId]) console.log(`        ${EXPLORERS[chainId]}${final.txHash}`);
    check(
      `${outcome.name}'s balance is correct`,
      (await available(outcome.account)) === before.get(outcome.account.address)! + DEPOSIT - PAYOUT,
    );
  }

  console.log(failures === 0 ? '\nAll checks passed. Two users round-tripped.' : `\n${failures} check(s) failed.`);
  console.log('This run was TEE-simulated, so it makes no confidentiality claim.');
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`\nStopped: ${describeError(error)}`);
  process.exitCode = 1;
});
