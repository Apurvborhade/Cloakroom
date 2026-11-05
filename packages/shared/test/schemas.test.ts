import { describe, it, expect } from 'vitest';
import {
  NATIVE,
  EnvelopeSchema,
  DepositRequestWireSchema,
  IntentWireSchema,
  CancelIntentWireSchema,
  WithdrawalWireSchema,
  PriceReportWireSchema,
  BalanceResponseSchema,
  IntentStatusResponseSchema,
  DepositSessionResponseSchema,
  WithdrawalResponseSchema,
  StandardErrorResponseSchema,
  SignedIntentSchema,
  wireToIntentMsg,
  wireToWithdrawalMsg,
  wireToDepositRequestMsg,
  wireToPriceReport,
} from '../src/index.js';

describe('EnvelopeSchema', () => {
  it('accepts valid envelope data', () => {
    const valid = {
      enc: 'BM8c4q...',
      ct: '5k8s9p...',
    };
    const result = EnvelopeSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects envelope with empty enc or ct', () => {
    expect(EnvelopeSchema.safeParse({ enc: '', ct: 'xyz' }).success).toBe(false);
    expect(EnvelopeSchema.safeParse({ enc: 'xyz', ct: '' }).success).toBe(false);
    expect(EnvelopeSchema.safeParse({}).success).toBe(false);
  });
});

describe('DepositRequestWireSchema', () => {
  const validOwner = '0x1111111111111111111111111111111111111111';

  it('accepts valid deposit request with NATIVE asset', () => {
    const valid = {
      owner: validOwner,
      asset: NATIVE,
      nonce: '0',
      expiry: '1700000000',
    };
    const result = DepositRequestWireSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      const msg = wireToDepositRequestMsg(result.data);
      expect(msg.owner).toBe(validOwner.toLowerCase());
      expect(msg.asset).toBe(NATIVE.toLowerCase());
      expect(msg.nonce).toBe(0n);
      expect(msg.expiry).toBe(1700000000n);
    }
  });

  it('rejects non-native deposit assets in v1', () => {
    const nonNative = {
      owner: validOwner,
      asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      nonce: '1',
      expiry: '1700000000',
    };
    const result = DepositRequestWireSchema.safeParse(nonNative);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Only native ETH deposits');
    }
  });

  it('rejects invalid address or non-decimal string nonce', () => {
    expect(
      DepositRequestWireSchema.safeParse({
        owner: '0xinvalid',
        asset: NATIVE,
        nonce: '0',
        expiry: '1700000000',
      }).success
    ).toBe(false);

    expect(
      DepositRequestWireSchema.safeParse({
        owner: validOwner,
        asset: NATIVE,
        nonce: '-1',
        expiry: '1700000000',
      }).success
    ).toBe(false);
  });
});

describe('IntentWireSchema', () => {
  const validIntent = {
    owner: '0x1111111111111111111111111111111111111111',
    tokenIn: NATIVE,
    tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    amountIn: '1000000000000000000',
    comparator: 0,
    triggerPrice: '3000000000000000000000',
    maxSlippageBps: 50,
    nonce: '1',
    expiry: '1700000300',
  };

  it('accepts valid intent and converts to bigint message', () => {
    const result = IntentWireSchema.safeParse(validIntent);
    expect(result.success).toBe(true);
    if (result.success) {
      const msg = wireToIntentMsg(result.data);
      expect(msg.amountIn).toBe(1000000000000000000n);
      expect(msg.triggerPrice).toBe(3000000000000000000000n);
      expect(msg.comparator).toBe(0);
      expect(msg.maxSlippageBps).toBe(50);
      expect(msg.nonce).toBe(1n);
      expect(msg.expiry).toBe(1700000300n);
    }
  });

  it('accepts comparator 1 (less than or equal to)', () => {
    const result = IntentWireSchema.safeParse({
      ...validIntent,
      comparator: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid comparator', () => {
    const result = IntentWireSchema.safeParse({
      ...validIntent,
      comparator: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects slippage above 10,000 bps (100%)', () => {
    const result = IntentWireSchema.safeParse({
      ...validIntent,
      maxSlippageBps: 10001,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer or float strings for amounts', () => {
    expect(
      IntentWireSchema.safeParse({
        ...validIntent,
        amountIn: '100.5',
      }).success
    ).toBe(false);

    expect(
      IntentWireSchema.safeParse({
        ...validIntent,
        triggerPrice: '3000e18',
      }).success
    ).toBe(false);
  });

  it('parses signed intent wrapper', () => {
    const signed = {
      message: validIntent,
      signature: ('0x' + 'ab'.repeat(65)) as `0x${string}`,
    };
    const result = SignedIntentSchema.safeParse(signed);
    expect(result.success).toBe(true);
  });
});

describe('CancelIntentWireSchema', () => {
  it('accepts valid cancel intent request', () => {
    const valid = {
      owner: '0x1111111111111111111111111111111111111111',
      intentId: '0x' + '01'.repeat(32),
      nonce: '2',
      expiry: '1700000300',
    };
    const result = CancelIntentWireSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid intentId length', () => {
    const invalid = {
      owner: '0x1111111111111111111111111111111111111111',
      intentId: '0x0102',
      nonce: '2',
      expiry: '1700000300',
    };
    expect(CancelIntentWireSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('WithdrawalWireSchema', () => {
  it('accepts valid withdrawal and converts to bigint message', () => {
    const valid = {
      owner: '0x1111111111111111111111111111111111111111',
      token: NATIVE,
      amount: '500000000000000000',
      to: '0x2222222222222222222222222222222222222222',
      nonce: '3',
      expiry: '1700000300',
    };
    const result = WithdrawalWireSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      const msg = wireToWithdrawalMsg(result.data);
      expect(msg.amount).toBe(500000000000000000n);
      expect(msg.to).toBe('0x2222222222222222222222222222222222222222');
      expect(msg.nonce).toBe(3n);
    }
  });
});

describe('PriceReportWireSchema', () => {
  it('accepts plain authenticated price report', () => {
    const report = {
      pair: 'ETH/USD',
      price: '3000000000000000000000',
      ts: 1700000000,
      source: 'cre',
    };
    const result = PriceReportWireSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = wireToPriceReport(result.data);
      expect(parsed.price).toBe(3000000000000000000000n);
      expect(parsed.source).toBe('cre');
    }
  });

  it('rejects invalid timestamp or non-positive price', () => {
    expect(
      PriceReportWireSchema.safeParse({
        pair: 'ETH/USD',
        price: '3000',
        ts: -1,
        source: 'cre',
      }).success
    ).toBe(false);
  });
});

describe('Response Schemas', () => {
  it('validates balance response schema', () => {
    const response = {
      balances: [
        {
          token: NATIVE,
          available: '1000000000000000000',
          reserved: '0',
          pending: '0',
        },
      ],
    };
    expect(BalanceResponseSchema.safeParse(response).success).toBe(true);
  });

  it('validates intent status response schema', () => {
    const response = {
      intents: [
        {
          id: 'intent-1',
          status: 'pending',
        },
        {
          id: 'intent-2',
          status: 'done',
          amountOut: '2985000000',
        },
      ],
    };
    expect(IntentStatusResponseSchema.safeParse(response).success).toBe(true);
  });

  it('validates deposit session response schema', () => {
    const response = {
      sessionId: 'dep-123',
      depositAddress: '0x3333333333333333333333333333333333333333',
      expiresAt: 1700000900,
    };
    expect(DepositSessionResponseSchema.safeParse(response).success).toBe(true);
  });

  it('validates withdrawal response schema', () => {
    const response = {
      withdrawalId: 'wd-456',
      status: 'locked',
    };
    expect(WithdrawalResponseSchema.safeParse(response).success).toBe(true);
  });

  it('validates standard error response schema', () => {
    const errorResponse = {
      error: 'INSUFFICIENT_BALANCE',
      message: 'Available balance is lower than requested withdrawal',
    };
    expect(StandardErrorResponseSchema.safeParse(errorResponse).success).toBe(true);
  });
});
