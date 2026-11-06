import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters } from 'viem';
import type { Address, Hex } from 'viem';
import { assertSafeTokenToNativeCalldata, minOutForLimit } from '../src/swap-calldata.js';

const ROUTER_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const EOA: Address = '0xb544e415F5109a37c9c364062168b2564CEA9481';
const ATTACKER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const WETH: Address = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const THIS: Address = '0x0000000000000000000000000000000000000002';
const NATIVE: Address = '0x0000000000000000000000000000000000000000';
const AMOUNT = 5_000_000n;
const MIN_OUT = 192_906_583_949_210n;
const NOW = 1_000n;

const path = (from: Address, to: Address): Hex =>
  `${from.toLowerCase()}0001f4${to.slice(2).toLowerCase()}` as Hex;
const swap = (overrides: Partial<{ recipient: Address; amount: bigint; route: Hex; payerIsUser: boolean }> = {}): [string, Hex] => [
  '00',
  encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
    overrides.recipient ?? THIS,
    overrides.amount ?? AMOUNT,
    0n,
    overrides.route ?? path(USDC, WETH),
    overrides.payerIsUser ?? true,
  ]),
];
const unwrap = (recipient: Address = EOA, minimum = MIN_OUT): [string, Hex] => [
  '0c',
  encodeAbiParameters(parseAbiParameters('address, uint256'), [recipient, minimum]),
];
const sweep = (token: Address = NATIVE, recipient: Address = EOA): [string, Hex] => [
  '04',
  encodeAbiParameters(parseAbiParameters('address, address, uint256'), [token, recipient, 0n]),
];

const build = (steps: Array<[string, Hex]>, deadline = NOW + 60n): Hex =>
  encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'execute',
    args: [`0x${steps.map(([command]) => command).join('')}`, steps.map(([, input]) => input), deadline],
  });
const check = (data: Hex) =>
  assertSafeTokenToNativeCalldata({
    data,
    eoa: EOA,
    tokenIn: USDC,
    wethAddress: WETH,
    amountIn: AMOUNT,
    minOut: MIN_OUT,
    nowSec: NOW,
  });

describe('assertSafeTokenToNativeCalldata', () => {
  // The exact commands Sepolia's Trading API returned for an address that had approved Permit2.
  it('accepts the shape the Trading API returns', () => {
    expect(() => check(build([swap(), unwrap(), sweep()]))).not.toThrow();
  });

  it.each([
    ['pays the swap output somewhere else', [swap({ recipient: ATTACKER }), unwrap(), sweep()], 'SWAP_RECIPIENT'],
    ['pays the ETH somewhere else', [swap(), unwrap(ATTACKER), sweep()], 'UNWRAP_RECIPIENT'],
    ['sweeps leftovers somewhere else', [swap(), unwrap(), sweep(NATIVE, ATTACKER)], 'SWEEP_RECIPIENT'],
    ['sweeps a token out', [swap(), unwrap(), sweep(USDC)], 'SWEEP_TOKEN'],
    ['lowers the minimum', [swap(), unwrap(EOA, MIN_OUT - 1n), sweep()], 'UNWRAP_MINIMUM'],
    ['spends more than approved', [swap({ amount: AMOUNT + 1n }), unwrap(), sweep()], 'SWAP_AMOUNT'],
    ['spends again in a second swap', [swap(), swap(), unwrap()], 'SWAP_AMOUNT'],
    ['spends a different token', [swap({ route: path(ATTACKER, WETH) }), unwrap()], 'SWAP_TOKEN'],
    ['ends in a different token', [swap({ route: path(USDC, ATTACKER) }), unwrap()], 'SWAP_TOKEN'],
    ['pays from the router', [swap({ payerIsUser: false }), unwrap()], 'SWAP_PAYER'],
    ['has no unwrap', [swap(), sweep()], 'OUTPUT_PATTERN'],
    ['unwraps twice', [swap(), unwrap(), unwrap()], 'OUTPUT_PATTERN'],
    ['swaps after unwrapping', [unwrap(), swap()], 'SWAP_AFTER_UNWRAP'],
    ['uses an unknown command', [swap(), unwrap(), ['05', '0x'] as [string, Hex]], 'UNKNOWN_COMMAND'],
  ])('refuses calldata that %s', (_name, steps, reason) => {
    expect(() => check(build(steps as Array<[string, Hex]>))).toThrow(reason as string);
  });

  it('refuses a passed deadline', () => {
    expect(() => check(build([swap(), unwrap()], NOW))).toThrow('DEADLINE_PASSED');
  });
});

describe('minOutForLimit', () => {
  const PRICE = 2_000n * 10n ** 18n;

  it('sells ETH for no less than the limit', () => {
    expect(minOutForLimit('sell', 10n ** 18n, PRICE, 6)).toBe(2_000_000_000n);
  });

  it('buys ETH at no more than the limit, rounding up', () => {
    expect(minOutForLimit('buy', 2_000_000_000n, PRICE, 6)).toBe(10n ** 18n);
    expect(minOutForLimit('buy', 1_000_001n, PRICE, 6)).toBe(500_000_500_000_000n);
    expect(minOutForLimit('buy', 3n, 7n * 10n ** 18n, 6)).toBe(428_571_428_572n);
  });
});
