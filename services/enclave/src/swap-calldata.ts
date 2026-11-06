import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, parseAbiParameters } from 'viem';
import type { Address, Hex } from 'viem';

const ROUTER_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

/** Universal Router's placeholders for "the router itself" and "whoever called the router". */
const ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002';
const MSG_SENDER: Address = '0x0000000000000000000000000000000000000001';
const NATIVE_SWEEP: Address = '0x0000000000000000000000000000000000000000';

const COMMAND_V3_SWAP_EXACT_IN = '00';
const COMMAND_SWEEP = '04';
const COMMAND_V2_SWAP_EXACT_IN = '08';
const COMMAND_WRAP_ETH = '0b';

const SWAP_V3 = parseAbiParameters('address, uint256, uint256, bytes, bool');
const SWAP_V2 = parseAbiParameters('address, uint256, uint256, address[], bool');
const SWEEP = parseAbiParameters('address, address, uint256');
const WRAP = parseAbiParameters('address, uint256');

export interface SwapCalldataRules {
  data: Hex;
  /** The custody EOA that sends the swap and must receive the output. */
  eoa: Address;
  tokenOut: Address;
  minOut: bigint;
  nowSec: bigint;
}

function unsafe(reason: string): Error {
  return new Error(`UNSAFE_SWAP_CALLDATA:${reason}`);
}

/** The token a swap ends in: the last 20 bytes of a V3 path, or the last entry of a V2 path. */
function finalToken(path: Hex | readonly Address[]): Address {
  if (typeof path === 'string') return getAddress(`0x${path.slice(-40)}`);
  return getAddress(path[path.length - 1] as Address);
}

/**
 * Refuses Trading API calldata unless it is a pattern we can prove pays the EOA at least minOut.
 *
 * The API is untrusted, and a simulation cannot show where the output goes, so this reads the
 * router commands. The router enforces each minimum on-chain. Two patterns are allowed:
 *
 * - Through the router: every swap leaves its output in the router, and exactly one SWEEP pays it
 *   to the EOA with a minimum of at least minOut.
 * - Direct: one or more swaps pay the EOA directly, each ending in the output token, and their
 *   minimums add up to at least minOut. Splitting rounds each part down, so the total may fall
 *   short by at most one unit for each extra swap.
 *
 * Any command not listed here is refused, including ones that could send funds elsewhere.
 */
export function assertSafeSwapCalldata(rules: SwapCalldataRules): void {
  const eoa = getAddress(rules.eoa);
  const tokenOut = getAddress(rules.tokenOut);

  let args: readonly [Hex, readonly Hex[], bigint];
  try {
    args = decodeFunctionData({ abi: ROUTER_ABI, data: rules.data }).args;
  } catch {
    throw unsafe('NOT_EXECUTE');
  }
  const [commands, inputs, deadline] = args;
  if (deadline <= rules.nowSec) throw unsafe('DEADLINE_PASSED');

  const bytes = commands.slice(2).match(/../g) ?? [];
  if (bytes.length !== inputs.length) throw unsafe('MALFORMED');

  const isEoa = (address: Address) => {
    const normalized = getAddress(address);
    return normalized === eoa || normalized === MSG_SENDER;
  };

  let outputSweeps = 0;
  let swapsToRouter = 0;
  let swapsToEoa = 0;
  let directMinimums = 0n;
  try {
    bytes.forEach((command, index) => {
      const input = inputs[index] as Hex;
      switch (command) {
        case COMMAND_WRAP_ETH: {
          const [recipient] = decodeAbiParameters(WRAP, input);
          if (getAddress(recipient) !== ADDRESS_THIS) throw unsafe('WRAP_RECIPIENT');
          break;
        }
        case COMMAND_V3_SWAP_EXACT_IN:
        case COMMAND_V2_SWAP_EXACT_IN: {
          const [recipient, , minimum, path, payerIsUser] = decodeAbiParameters(
            command === COMMAND_V3_SWAP_EXACT_IN ? SWAP_V3 : SWAP_V2,
            input,
          );
          if (payerIsUser) throw unsafe('SWAP_PAYER');
          if (getAddress(recipient) === ADDRESS_THIS) {
            swapsToRouter += 1;
          } else if (isEoa(recipient)) {
            if (finalToken(path) !== tokenOut) throw unsafe('SWAP_TOKEN');
            directMinimums += minimum;
            swapsToEoa += 1;
          } else {
            throw unsafe('SWAP_RECIPIENT');
          }
          break;
        }
        case COMMAND_SWEEP: {
          const [token, recipient, minimum] = decodeAbiParameters(SWEEP, input);
          if (!isEoa(recipient)) throw unsafe('SWEEP_RECIPIENT');
          const swept = getAddress(token);
          if (swept === tokenOut) {
            if (minimum < rules.minOut) throw unsafe('SWEEP_MINIMUM');
            outputSweeps += 1;
          } else if (swept !== NATIVE_SWEEP) {
            throw unsafe('SWEEP_TOKEN');
          }
          break;
        }
        default:
          throw unsafe('UNKNOWN_COMMAND');
      }
    });
  } catch (error) {
    if ((error as Error).message.startsWith('UNSAFE_SWAP_CALLDATA')) throw error;
    throw unsafe('MALFORMED');
  }

  const throughRouter = swapsToEoa === 0 && outputSweeps === 1;
  const direct = swapsToEoa > 0 && swapsToRouter === 0 && outputSweeps === 0;
  if (!throughRouter && !direct) throw unsafe('OUTPUT_PATTERN');
  if (direct && directMinimums + BigInt(swapsToEoa - 1) < rules.minOut) throw unsafe('SWAP_MINIMUM');
}
