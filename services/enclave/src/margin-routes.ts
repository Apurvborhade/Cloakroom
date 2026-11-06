import {
  ERROR_CODES,
  SignedMarginAddCollateralSchema,
  SignedMarginCloseSchema,
  SignedMarginOpenSchema,
  SignedMarginSupplySchema,
  SignedSessionQuerySchema,
  wireToMarginAddCollateralMsg,
  wireToMarginCloseMsg,
  wireToMarginOpenMsg,
  wireToMarginSupplyMsg,
  wireToSessionQueryMsg,
} from '@cloakroom/shared';
import type { MarginAccounting, PositionView, PriceReport } from '@cloakroom/shared';
import type { FastifyInstance } from 'fastify';
import { getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { AuthError } from './auth.js';
import type { AuthService } from './auth.js';
import type { KeyManager } from './keys.js';
import type { MarginOrders } from './margin-orders.js';
// Only used as functions at request time, after both modules have loaded.
import { authorizeRead, privateRoute } from './routes.js';

export interface MarginRouteDeps {
  accounting: MarginAccounting;
  orders: Pick<MarginOrders, 'open' | 'close'>;
  riskPrices: { latest(): PriceReport | null };
  /** The tokens lending and collateral accept. */
  tokens: readonly Address[];
}

function positionWire(position: PositionView) {
  const optional = (name: string, value: bigint | undefined) =>
    value === undefined ? {} : { [name]: value.toString() };
  return {
    id: position.id,
    side: position.side,
    status: position.status,
    collateral: position.collateral.toString(),
    sizeUsd: position.sizeUsd.toString(),
    debtToken: position.debtToken,
    debt: position.debt.toString(),
    assetToken: position.assetToken,
    asset: position.asset.toString(),
    ...optional('entryPrice', position.entryPrice),
    ...optional('liquidationPrice', position.liquidationPrice),
    ...optional('equity', position.equity),
    ...optional('payout', position.payout),
    ...optional('shortfall', position.shortfall),
    ...(position.reason === undefined ? {} : { reason: position.reason }),
  };
}

/** Signed by the owner and encrypted, like every other request. Session keys can only read. */
export function marginRoutes(
  app: FastifyInstance,
  deps: MarginRouteDeps & { auth: AuthService; keys: KeyManager },
): void {
  const { accounting, auth, keys, orders, riskPrices, tokens } = deps;
  const accepted = new Set(tokens.map((token) => getAddress(token)));
  const assertLendable = (token: Address, amount: bigint) => {
    if (!accepted.has(getAddress(token))) throw new AuthError(ERROR_CODES.UNSUPPORTED_ASSET);
    if (amount <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
  };

  privateRoute(app, keys, '/margin/lending/supply', SignedMarginSupplySchema, async ({ message, signature }) => {
    const supply = wireToMarginSupplyMsg(message);
    assertLendable(supply.token, supply.amount);
    const { owner } = await auth.verifyAndAuthorizeMutation('MarginSupply', supply, signature as Hex);
    await accounting.supply(owner, supply);
    return { ok: true };
  });

  privateRoute(app, keys, '/margin/lending/redeem', SignedMarginSupplySchema, async ({ message, signature }) => {
    const redeem = wireToMarginSupplyMsg(message);
    assertLendable(redeem.token, redeem.amount);
    const { owner } = await auth.verifyAndAuthorizeMutation('MarginRedeem', redeem, signature as Hex);
    await accounting.redeem(owner, redeem);
    return { ok: true };
  });

  privateRoute(app, keys, '/margin/positions/open', SignedMarginOpenSchema, async ({ message, signature }) => {
    const open = wireToMarginOpenMsg(message);
    if (open.collateral <= 0n || open.limitPrice <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
    const { owner } = await auth.verifyAndAuthorizeMutation('MarginOpen', open, signature as Hex);
    return { positionId: await orders.open(owner, open), status: 'opening' };
  });

  privateRoute(
    app,
    keys,
    '/margin/positions/collateral',
    SignedMarginAddCollateralSchema,
    async ({ message, signature }) => {
      const add = wireToMarginAddCollateralMsg(message);
      if (add.amount <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
      const { owner } = await auth.verifyAndAuthorizeMutation('MarginAddCollateral', add, signature as Hex);
      await accounting.addCollateral(owner, add);
      return { ok: true };
    },
  );

  privateRoute(app, keys, '/margin/positions/close', SignedMarginCloseSchema, async ({ message, signature }) => {
    const close = wireToMarginCloseMsg(message);
    if (close.limitPrice <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
    const { owner } = await auth.verifyAndAuthorizeMutation('MarginClose', close, signature as Hex);
    return { positionId: await orders.close(owner, close), status: 'closing' };
  });

  privateRoute(app, keys, '/margin/positions', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    return { positions: accounting.positions(owner, riskPrices.latest()).map(positionWire) };
  });

  privateRoute(app, keys, '/margin/lending', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    return {
      lending: accounting.lending(owner).map(({ available, supplied, token }) => ({
        token,
        supplied: supplied.toString(),
        available: available.toString(),
      })),
    };
  });
}
