import { describe, expect, it } from 'vitest';
import { MARGIN_MVP_MAX_LEVERAGE_BPS, parseConfig } from '@/lib/config';

describe('parseConfig', () => {
  it('defaults to Sepolia, Anon-RPC reads and auto margin, and reports what is missing', () => {
    const config = parseConfig({});
    expect(config.chainId).toBe(11155111);
    expect(config.chainRead.mode).toBe('anon-rpc');
    expect(config.marginUi).toBe('auto');
    expect(config.allowSimulatedEnclave).toBe(false);
    expect(config.apiUrl).toBeNull();
    expect(config.issues.join(' ')).toMatch(/NEXT_PUBLIC_CLOAKROOM_API_URL/);
    expect(config.issues.join(' ')).toMatch(/Anon-RPC/);
  });

  it('never enables a direct RPC unless direct-dev is chosen explicitly', () => {
    const config = parseConfig({ NEXT_PUBLIC_DEV_DIRECT_RPC_URL: 'https://rpc.example' });
    expect(config.chainRead.mode).toBe('anon-rpc');
    const dev = parseConfig({ NEXT_PUBLIC_CHAIN_READ_MODE: 'direct-dev', NEXT_PUBLIC_DEV_DIRECT_RPC_URL: 'https://rpc.example' });
    expect(dev.chainRead.mode).toBe('direct-dev');
  });

  it('caps margin leverage at the 4x MVP scope', () => {
    expect(parseConfig({ NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS: '1000000' }).marginMaxLeverageBps).toBe(MARGIN_MVP_MAX_LEVERAGE_BPS);
    expect(parseConfig({ NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS: '20000' }).marginMaxLeverageBps).toBe(20_000);
  });

  it('validates addresses, URLs and numbers without echoing values', () => {
    const config = parseConfig({
      NEXT_PUBLIC_CLOAKROOM_API_URL: 'ftp://nope',
      NEXT_PUBLIC_TOKEN_OUT_ADDRESS: '0x123',
      NEXT_PUBLIC_TOKEN_OUT_DECIMALS: 'six',
      NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI: '1e18',
    });
    expect(config.apiUrl).toBeNull();
    expect(config.tokenOut).toBeNull();
    expect(config.maxAmountNativeWei).toBe(10n ** 18n);
    expect(config.issues.join(' ')).not.toContain('ftp://nope');
  });

  it('reads token and limits exactly', () => {
    const config = parseConfig({
      NEXT_PUBLIC_CLOAKROOM_API_URL: 'http://127.0.0.1:8787/',
      NEXT_PUBLIC_CHAIN_ID: '31337',
      NEXT_PUBLIC_TOKEN_OUT_ADDRESS: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
      NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI: '123456789012345678901',
    });
    expect(config.apiUrl).toBe('http://127.0.0.1:8787');
    expect(config.chain.id).toBe(31337);
    expect(config.tokenOut?.address).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    expect(config.tokenOut?.decimals).toBe(6);
    expect(config.maxAmountNativeWei).toBe(123_456_789_012_345_678_901n);
  });
});
