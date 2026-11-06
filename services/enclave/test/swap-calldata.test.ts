import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters } from 'viem';
import type { Address, Hex } from 'viem';
import { assertSafeSwapCalldata, limitFloor } from '../src/swap-calldata.js';
import { SEPOLIA_DIRECT_SPLIT_QUOTE, SEPOLIA_QUOTE, SEPOLIA_SINGLE_ROUTE_QUOTE } from './fixtures/sepolia-quote.js';

const ROUTER_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const EOA: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ATTACKER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const TOKEN: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const OTHER_TOKEN: Address = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const THIS: Address = '0x0000000000000000000000000000000000000002';
const SENDER: Address = '0x0000000000000000000000000000000000000001';
const NATIVE: Address = '0x0000000000000000000000000000000000000000';
const MIN_OUT = 1000n;
const NOW = 1_000n;
const PATH: Hex = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14000bb81c7d4b196cb0c7b01d743fbc6116a902379c7238';

const OTHER_PATH: Hex = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238000bb8fff9976782d46cc05630d1f6ebab18b2324d6b14';

const wrap = (recipient: Address = THIS): [string, Hex] => [
  '0b',
  encodeAbiParameters(parseAbiParameters('address, uint256'), [recipient, 5n]),
];
const swapV3 = (
  recipient: Address = THIS,
  payerIsUser = false,
  minimum = 0n,
  path: Hex = PATH,
): [string, Hex] => [
  '00',
  encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
    recipient,
    5n,
    minimum,
    path,
    payerIsUser,
  ]),
];
const swapV2 = (
  recipient: Address = THIS,
  payerIsUser = false,
  minimum = 0n,
  path: Address[] = [OTHER_TOKEN, TOKEN],
): [string, Hex] => [
  '08',
  encodeAbiParameters(parseAbiParameters('address, uint256, uint256, address[], bool'), [
    recipient,
    5n,
    minimum,
    path,
    payerIsUser,
  ]),
];
const sweep = (token: Address = TOKEN, recipient: Address = EOA, minimum = MIN_OUT): [string, Hex] => [
  '04',
  encodeAbiParameters(parseAbiParameters('address, address, uint256'), [token, recipient, minimum]),
];

function build(commands: Array<[string, Hex]>, deadline = NOW + 60n): Hex {
  return encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'execute',
    args: [`0x${commands.map(([byte]) => byte).join('')}`, commands.map(([, input]) => input), deadline],
  });
}

const check = (data: Hex) =>
  assertSafeSwapCalldata({ data, eoa: EOA, tokenOut: TOKEN, minOut: MIN_OUT, floor: 0n, nowSec: NOW });

describe('limitFloor', () => {
  it('is the amount times the limit price, with no slippage taken off', () => {
    expect(limitFloor(10n ** 17n, 3_000n * 10n ** 18n, 6)).toBe(300_000_000n);
  });

  it('rounds up, so a fill cannot land just under the limit', () => {
    expect(limitFloor(1n, 10n ** 18n, 6)).toBe(1n);
    expect(limitFloor(10n ** 18n + 1n, 10n ** 18n, 6)).toBe(1_000_001n);
  });
});

describe('the limit floor in calldata', () => {
  const half = MIN_OUT / 2n;
  const checkFloor = (data: Hex, floor: bigint) =>
    assertSafeSwapCalldata({ data, eoa: EOA, tokenOut: TOKEN, minOut: MIN_OUT, floor, nowSec: NOW });

  it('accepts minimums exactly at the floor', () => {
    expect(() => checkFloor(build([swapV3(), sweep(TOKEN, EOA, MIN_OUT)]), MIN_OUT)).not.toThrow();
    expect(() => checkFloor(build([swapV3(EOA, false, half), swapV3(EOA, false, half)]), MIN_OUT)).not.toThrow();
  });

  it('refuses a sweep that clears minOut but not the floor', () => {
    expect(() => checkFloor(build([swapV3(), sweep(TOKEN, EOA, MIN_OUT)]), MIN_OUT + 1n)).toThrow('LIMIT_FLOOR');
  });

  it('gives split swaps no rounding tolerance against the floor', () => {
    const split = build([swapV3(EOA, false, half), swapV3(EOA, false, half - 1n)]);

    expect(() => checkFloor(split, MIN_OUT - 1n)).not.toThrow();
    expect(() => checkFloor(split, MIN_OUT)).toThrow('LIMIT_FLOOR');
  });
});

describe('assertSafeSwapCalldata', () => {
  it('accepts a real Trading API response from Sepolia', () => {
    expect(() =>
      assertSafeSwapCalldata({
        data: SEPOLIA_QUOTE.data,
        eoa: SEPOLIA_QUOTE.eoa,
        tokenOut: SEPOLIA_QUOTE.tokenOut,
        minOut: SEPOLIA_QUOTE.minOut,
        floor: 0n,
        nowSec: SEPOLIA_QUOTE.deadline - 1n,
      }),
    ).not.toThrow();
  });

  it('rejects that same real response for anyone else', () => {
    expect(() =>
      assertSafeSwapCalldata({
        data: SEPOLIA_QUOTE.data,
        eoa: ATTACKER,
        tokenOut: SEPOLIA_QUOTE.tokenOut,
        minOut: SEPOLIA_QUOTE.minOut,
        floor: 0n,
        nowSec: SEPOLIA_QUOTE.deadline - 1n,
      }),
    ).toThrow('SWEEP_RECIPIENT');
  });

  it('rejects that same real response above its real minimum', () => {
    expect(() =>
      assertSafeSwapCalldata({
        data: SEPOLIA_QUOTE.data,
        eoa: SEPOLIA_QUOTE.eoa,
        tokenOut: SEPOLIA_QUOTE.tokenOut,
        minOut: SEPOLIA_QUOTE.minOut + 1n,
        floor: 0n,
        nowSec: SEPOLIA_QUOTE.deadline - 1n,
      }),
    ).toThrow('SWEEP_MINIMUM');
  });

  describe('a single route, where the swap pays the EOA directly', () => {
    it('accepts a real Trading API response from Sepolia', () => {
      expect(() =>
        assertSafeSwapCalldata({
          data: SEPOLIA_SINGLE_ROUTE_QUOTE.data,
          eoa: SEPOLIA_SINGLE_ROUTE_QUOTE.eoa,
          tokenOut: SEPOLIA_SINGLE_ROUTE_QUOTE.tokenOut,
          minOut: SEPOLIA_SINGLE_ROUTE_QUOTE.minOut,
          floor: 0n,
          nowSec: SEPOLIA_SINGLE_ROUTE_QUOTE.deadline - 1n,
        }),
      ).not.toThrow();
    });

    it('rejects that same real response for anyone else', () => {
      expect(() =>
        assertSafeSwapCalldata({
          data: SEPOLIA_SINGLE_ROUTE_QUOTE.data,
          eoa: ATTACKER,
          tokenOut: SEPOLIA_SINGLE_ROUTE_QUOTE.tokenOut,
          minOut: SEPOLIA_SINGLE_ROUTE_QUOTE.minOut,
          floor: 0n,
          nowSec: SEPOLIA_SINGLE_ROUTE_QUOTE.deadline - 1n,
        }),
      ).toThrow('SWAP_RECIPIENT');
    });

    it('rejects that same real response above its real minimum', () => {
      expect(() =>
        assertSafeSwapCalldata({
          data: SEPOLIA_SINGLE_ROUTE_QUOTE.data,
          eoa: SEPOLIA_SINGLE_ROUTE_QUOTE.eoa,
          tokenOut: SEPOLIA_SINGLE_ROUTE_QUOTE.tokenOut,
          minOut: SEPOLIA_SINGLE_ROUTE_QUOTE.minOut + 1n,
          floor: 0n,
          nowSec: SEPOLIA_SINGLE_ROUTE_QUOTE.deadline - 1n,
        }),
      ).toThrow('SWAP_MINIMUM');
    });

    it('accepts V3 and V2 swaps, a refund, and the placeholder for the caller', () => {
      expect(() => check(build([wrap(), swapV3(EOA, false, MIN_OUT)]))).not.toThrow();
      expect(() => check(build([wrap(), swapV2(EOA, false, MIN_OUT)]))).not.toThrow();
      expect(() => check(build([wrap(), swapV3(EOA, false, MIN_OUT), sweep(NATIVE, EOA, 0n)]))).not.toThrow();
      expect(() => check(build([wrap(), swapV3(SENDER, false, MIN_OUT)]))).not.toThrow();
    });

    it.each<[string, Array<[string, Hex]>, string]>([
      ['a V3 minimum below minOut', [wrap(), swapV3(EOA, false, MIN_OUT - 1n)], 'SWAP_MINIMUM'],
      ['a V2 minimum below minOut', [wrap(), swapV2(EOA, false, MIN_OUT - 1n)], 'SWAP_MINIMUM'],
      ['a zero minimum', [wrap(), swapV3(EOA)], 'SWAP_MINIMUM'],
      ['a V3 path ending in another token', [wrap(), swapV3(EOA, false, MIN_OUT, OTHER_PATH)], 'SWAP_TOKEN'],
      ['a V2 path ending in another token', [wrap(), swapV2(EOA, false, MIN_OUT, [TOKEN, OTHER_TOKEN])], 'SWAP_TOKEN'],
      ['pulling funds from the EOA', [swapV3(EOA, true, MIN_OUT)], 'SWAP_PAYER'],
      ['paying an attacker', [wrap(), swapV3(ATTACKER, false, MIN_OUT)], 'SWAP_RECIPIENT'],
      ['a direct swap beside one left in the router', [swapV3(EOA, false, MIN_OUT), swapV3()], 'OUTPUT_PATTERN'],
      ['a direct swap beside an output sweep', [swapV3(EOA, false, MIN_OUT), sweep()], 'OUTPUT_PATTERN'],
    ])('rejects %s', (_name, commands, reason) => {
      expect(() => check(build(commands))).toThrow(reason);
    });
  });

  describe('several swaps that each pay the EOA directly', () => {
    const half = MIN_OUT / 2n;

    it('accepts a real Trading API response from Sepolia', () => {
      expect(() =>
        assertSafeSwapCalldata({
          data: SEPOLIA_DIRECT_SPLIT_QUOTE.data,
          eoa: SEPOLIA_DIRECT_SPLIT_QUOTE.eoa,
          tokenOut: SEPOLIA_DIRECT_SPLIT_QUOTE.tokenOut,
          minOut: SEPOLIA_DIRECT_SPLIT_QUOTE.minOut,
          floor: 0n,
          nowSec: SEPOLIA_DIRECT_SPLIT_QUOTE.deadline - 1n,
        }),
      ).not.toThrow();
    });

    it('rejects that same real response for anyone else', () => {
      expect(() =>
        assertSafeSwapCalldata({
          data: SEPOLIA_DIRECT_SPLIT_QUOTE.data,
          eoa: ATTACKER,
          tokenOut: SEPOLIA_DIRECT_SPLIT_QUOTE.tokenOut,
          minOut: SEPOLIA_DIRECT_SPLIT_QUOTE.minOut,
          floor: 0n,
          nowSec: SEPOLIA_DIRECT_SPLIT_QUOTE.deadline - 1n,
        }),
      ).toThrow('SWAP_RECIPIENT');
    });

    it('rejects that same real response beyond its rounding', () => {
      expect(() =>
        assertSafeSwapCalldata({
          data: SEPOLIA_DIRECT_SPLIT_QUOTE.data,
          eoa: SEPOLIA_DIRECT_SPLIT_QUOTE.eoa,
          tokenOut: SEPOLIA_DIRECT_SPLIT_QUOTE.tokenOut,
          minOut: SEPOLIA_DIRECT_SPLIT_QUOTE.minOut + 1n,
          floor: 0n,
          nowSec: SEPOLIA_DIRECT_SPLIT_QUOTE.deadline - 1n,
        }),
      ).toThrow('SWAP_MINIMUM');
    });

    it('accepts minimums that add up to minOut', () => {
      expect(() => check(build([wrap(), swapV3(EOA, false, half), swapV3(EOA, false, half)]))).not.toThrow();
      expect(() => check(build([wrap(), swapV3(EOA, false, half), swapV2(EOA, false, half), sweep(NATIVE, EOA, 0n)]))).not.toThrow();
    });

    it('allows one unit of rounding for each extra swap, and no more', () => {
      expect(() => check(build([swapV3(EOA, false, half), swapV3(EOA, false, half - 1n)]))).not.toThrow();
      expect(() => check(build([swapV3(EOA, false, half), swapV3(EOA, false, half - 2n)]))).toThrow('SWAP_MINIMUM');
      expect(() => check(build([swapV3(EOA, false, MIN_OUT - 1n)]))).toThrow('SWAP_MINIMUM');
    });

    it.each<[string, Array<[string, Hex]>, string]>([
      ['minimums that fall well short', [swapV3(EOA, false, 1n), swapV3(EOA, false, 1n)], 'SWAP_MINIMUM'],
      ['one swap with no minimum, however large the other', [swapV3(EOA, false, 0n), swapV3(EOA, false, MIN_OUT - 2n)], 'SWAP_MINIMUM'],
      ['one part ending in another token', [swapV3(EOA, false, MIN_OUT), swapV3(EOA, false, 1n, OTHER_PATH)], 'SWAP_TOKEN'],
      ['one part paying an attacker', [swapV3(EOA, false, MIN_OUT), swapV3(ATTACKER, false, MIN_OUT)], 'SWAP_RECIPIENT'],
      ['one part pulling funds from the EOA', [swapV3(EOA, false, MIN_OUT), swapV3(EOA, true, MIN_OUT)], 'SWAP_PAYER'],
      ['one part left in the router', [swapV3(EOA, false, MIN_OUT), swapV3()], 'OUTPUT_PATTERN'],
      ['a direct swap beside an output sweep', [swapV3(EOA, false, half), swapV3(EOA, false, half), sweep()], 'OUTPUT_PATTERN'],
    ])('rejects %s', (_name, commands, reason) => {
      expect(() => check(build(commands))).toThrow(reason);
    });
  });

  it('accepts a V3 route, a V2 route, and a split route with a refund', () => {
    expect(() => check(build([wrap(), swapV3(), sweep()]))).not.toThrow();
    expect(() => check(build([wrap(), swapV2(), sweep()]))).not.toThrow();
    expect(() => check(build([wrap(), swapV3(), swapV3(), swapV2(), sweep(), sweep(NATIVE, EOA, 0n)]))).not.toThrow();
  });

  it('accepts the router placeholder for the caller as recipient', () => {
    expect(() => check(build([wrap(), swapV3(), sweep(TOKEN, SENDER)]))).not.toThrow();
  });

  it('accepts a minimum exactly at minOut', () => {
    expect(() => check(build([swapV3(), sweep(TOKEN, EOA, MIN_OUT)]))).not.toThrow();
  });

  it.each<[string, Array<[string, Hex]>, string]>([
    ['output swept to an attacker', [wrap(), swapV3(), sweep(TOKEN, ATTACKER)], 'SWEEP_RECIPIENT'],
    ['refund swept to an attacker', [wrap(), swapV3(), sweep(), sweep(NATIVE, ATTACKER, 0n)], 'SWEEP_RECIPIENT'],
    ['a minimum below minOut', [wrap(), swapV3(), sweep(TOKEN, EOA, MIN_OUT - 1n)], 'SWEEP_MINIMUM'],
    ['a zero minimum', [wrap(), swapV3(), sweep(TOKEN, EOA, 0n)], 'SWEEP_MINIMUM'],
    ['no output sweep', [wrap(), swapV3()], 'OUTPUT_PATTERN'],
    ['only a refund sweep', [wrap(), swapV3(), sweep(NATIVE, EOA, 0n)], 'OUTPUT_PATTERN'],
    ['two output sweeps', [swapV3(), sweep(), sweep()], 'OUTPUT_PATTERN'],
    ['no swap at all', [wrap()], 'OUTPUT_PATTERN'],
    ['a sweep of some other token', [swapV3(), sweep(), sweep(OTHER_TOKEN)], 'SWEEP_TOKEN'],
    ['a V3 swap paying an attacker directly', [wrap(), swapV3(ATTACKER), sweep()], 'SWAP_RECIPIENT'],
    ['a V3 swap paying the sender alongside an output sweep', [wrap(), swapV3(SENDER), sweep()], 'OUTPUT_PATTERN'],
    ['a V2 swap paying an attacker directly', [wrap(), swapV2(ATTACKER), sweep()], 'SWAP_RECIPIENT'],
    ['a V3 swap pulling funds from the EOA', [swapV3(THIS, true), sweep()], 'SWAP_PAYER'],
    ['a V2 swap pulling funds from the EOA', [swapV2(THIS, true), sweep()], 'SWAP_PAYER'],
    ['wrapped ETH sent to an attacker', [wrap(ATTACKER), swapV3(), sweep()], 'WRAP_RECIPIENT'],
    ['a V4 swap, which cannot be checked', [['10', '0x'], sweep()], 'UNKNOWN_COMMAND'],
    ['a PAY_PORTION to a third party', [swapV3(), ['06', '0x'], sweep()], 'UNKNOWN_COMMAND'],
    ['a plain TRANSFER', [swapV3(), ['05', '0x'], sweep()], 'UNKNOWN_COMMAND'],
    ['a command with the allow-revert flag', [swapV3(), ['84', sweep()[1]]], 'UNKNOWN_COMMAND'],
  ])('rejects %s', (_name, commands, reason) => {
    expect(() => check(build(commands))).toThrow(reason);
  });

  it('rejects a deadline that has passed, or is exactly now', () => {
    expect(() => check(build([swapV3(), sweep()], NOW - 1n))).toThrow('DEADLINE_PASSED');
    expect(() => check(build([swapV3(), sweep()], NOW))).toThrow('DEADLINE_PASSED');
  });

  it('rejects a call to another function', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 amount)']),
      functionName: 'transfer',
      args: [ATTACKER, 1n],
    });

    expect(() => check(data)).toThrow('NOT_EXECUTE');
  });

  it('rejects garbage and empty data', () => {
    expect(() => check('0x')).toThrow('NOT_EXECUTE');
    expect(() => check('0xdeadbeef')).toThrow('NOT_EXECUTE');
  });

  it('rejects commands and inputs of different lengths', () => {
    const data = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: 'execute',
      args: ['0x0004', [swapV3()[1]], NOW + 60n],
    });

    expect(() => check(data)).toThrow('MALFORMED');
  });

  it('rejects inputs that cannot be decoded', () => {
    expect(() => check(build([['04', '0x1234']]))).toThrow('MALFORMED');
  });
});
