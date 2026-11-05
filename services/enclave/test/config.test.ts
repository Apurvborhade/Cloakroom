import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENV_VARIABLES, loadConfig } from '../src/config.js';

const EXAMPLE_PATH = new URL('../../../.env.example', import.meta.url);

function readExample(): Record<string, string> {
  const entries = readFileSync(EXAMPLE_PATH, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line): [string, string] => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    });
  return Object.fromEntries(entries);
}

/** .env.example with its blank secrets and personal values filled in. */
function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ...readExample(),
    RPC_URL: 'https://rpc.example/secret-key-in-url',
    UNISWAP_API_KEY: 'test-api-key',
    ADMIN_ADDRESS: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    ALLOWED_ORIGIN: 'https://app.example',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('stays in step with .env.example', () => {
    expect(Object.keys(readExample()).sort()).toEqual([...ENV_VARIABLES].sort());
  });

  it('parses every kind of value', () => {
    const config = loadConfig(
      validEnv({
        CHAIN_ID: '11155111',
        CONFIRMATIONS: '2',
        GAS_RESERVE_WEI: '10000000000000000',
        SEEDING_ENABLED: 'false',
        SIM_MODE: 'true',
        WETH_ADDRESS: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      }),
    );

    expect(config.CHAIN_ID).toBe(11155111);
    expect(config.CONFIRMATIONS).toBe(2);
    expect(config.GAS_RESERVE_WEI).toBe(10000000000000000n);
    expect(config.SEEDING_ENABLED).toBe(false);
    expect(config.SIM_MODE).toBe(true);
    expect(config.WETH_ADDRESS).toBe('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14');
  });

  it('keeps wei values exact above the safe integer range', () => {
    const config = loadConfig(validEnv({ MAX_AMOUNT_NATIVE_WEI: '123456789012345678901234567890' }));

    expect(config.MAX_AMOUNT_NATIVE_WEI).toBe(123456789012345678901234567890n);
  });

  it('allows zero confirmations and zero fees, which are valid settings', () => {
    const config = loadConfig(validEnv({ CONFIRMATIONS: '0', FEE_BPS: '0' }));

    expect(config.CONFIRMATIONS).toBe(0);
    expect(config.FEE_BPS).toBe(0);
  });

  it.each(ENV_VARIABLES)('refuses to start without %s', (name) => {
    expect(() => loadConfig(validEnv({ [name]: undefined }))).toThrow(name);
  });

  it.each([
    ['CHAIN_ID', '0'],
    ['CHAIN_ID', 'sepolia'],
    ['CONFIRMATIONS', '-1'],
    ['CONFIRMATIONS', '1.5'],
    ['RPC_URL', 'not a url'],
    ['GAS_RESERVE_WEI', '0.01'],
    ['GAS_MARGIN_PERCENT', '99'],
    ['RECEIPT_TIMEOUT_MS', '0'],
    ['INVENTORY_SETTLE_ATTEMPTS', '0'],
    ['UNIVERSAL_ROUTER_ADDRESS', '0x1234'],
    ['UNISWAP_API_KEY', ''],
    ['MAX_SLIPPAGE_BPS_CAP', '10001'],
    ['FEE_BPS', '10001'],
    ['PRICE_REFERENCE_AMOUNT_WEI', '0'],
    ['SEEDING_ENABLED', 'yes'],
    ['SIM_MODE', '1'],
    ['CHAIN_ID', '99999999999999999999'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig(validEnv({ [name]: value }))).toThrow(name);
  });

  it('reports every bad variable at once', () => {
    expect(() => loadConfig(validEnv({ CHAIN_ID: undefined, FEE_BPS: 'x' }))).toThrow(
      'Missing or invalid environment variables: CHAIN_ID, FEE_BPS',
    );
  });

  it('never puts values in the error message', () => {
    let message = '';
    try {
      loadConfig(
        validEnv({ RPC_URL: 'not-a-url-but-a-secret-value', UNISWAP_API_KEY: 'another-secret' , CHAIN_ID: undefined }),
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('RPC_URL');
    expect(message).not.toContain('not-a-url-but-a-secret-value');
    expect(message).not.toContain('another-secret');
  });
});
