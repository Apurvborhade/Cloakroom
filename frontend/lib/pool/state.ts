import { PoolOrderConfig, PoolOrderRecord, PoolActivityItem } from "./types";
import {
  calculateMarketQuote,
  calculateLimitQuote,
  REFERENCE_ETH_PRICE,
} from "./calculations";
import { parseUnits, formatUnits } from "viem";

const POOL_CONFIG_KEY = "cloakroom_pool_config_v1";
const POOL_ORDERS_KEY = "cloakroom_pool_orders_v1";
const POOL_ACTIVITY_KEY = "cloakroom_pool_activity_v1";

// --- Active Config Management ---
export function savePoolConfig(config: PoolOrderConfig): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(POOL_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // quota/private browsing fallback
  }
}

export function loadPoolConfig(): PoolOrderConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(POOL_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPoolConfig(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(POOL_CONFIG_KEY);
  } catch {
    // ignore
  }
}

// --- Order Records Management ---
export function savePoolOrder(order: PoolOrderRecord): void {
  if (typeof window === "undefined") return;
  try {
    const orders = getAllPoolOrders();
    const existingIndex = orders.findIndex((o) => o.id === order.id);
    if (existingIndex >= 0) {
      orders[existingIndex] = order;
    } else {
      orders.unshift(order);
    }
    localStorage.setItem(POOL_ORDERS_KEY, JSON.stringify(orders.slice(0, 50)));

    // Sync to activity if terminal state
    if (order.status === "completed" || order.status === "cancelled") {
      addPoolActivity({
        id: order.id,
        type: order.orderType === "MARKET" ? "POOL_MARKET" : "POOL_LIMIT",
        tradingPair: order.tradingPair,
        sellAmount: `${order.sellAmount} ${order.sellAsset}`,
        buyAmount: `${order.actualOutput || order.estimatedOutput} ${order.buyAsset}`,
        executionPrice: order.executionPrice || order.targetPrice || `$${order.orderType === "LIMIT" ? order.targetPrice : "3,200.00"}`,
        status: order.status === "completed" ? "completed" : "cancelled",
        timestamp: order.completedAt || order.cancelledAt || new Date().toISOString(),
        txHash: order.txHash,
        batchId: order.batchId,
        isSimulation: order.isSimulation,
      });
    }
  } catch {
    // ignore
  }
}

export function getPoolOrderById(orderId: string): PoolOrderRecord | null {
  const orders = getAllPoolOrders();
  return orders.find((o) => o.id === orderId) || null;
}

export function getAllPoolOrders(): PoolOrderRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POOL_ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getActiveLimitOrders(): PoolOrderRecord[] {
  const orders = getAllPoolOrders();
  return orders.filter(
    (o) =>
      o.orderType === "LIMIT" &&
      (o.status === "active_waiting" ||
        o.status === "submitted" ||
        o.status === "order_created" ||
        o.status === "funds_reserved" ||
        o.status === "cancellation_requested")
  );
}

export function getActivePoolOrders(): PoolOrderRecord[] {
  const orders = getAllPoolOrders();
  return orders.filter(
    (o) =>
      o.status === "active_waiting" ||
      o.status === "submitted" ||
      o.status === "order_created" ||
      o.status === "funds_reserved" ||
      o.status === "preparing" ||
      o.status === "awaiting_signature" ||
      o.status === "processing" ||
      o.status === "cancellation_requested"
  );
}

export function requestCancelPoolOrder(orderId: string): boolean {
  const orders = getAllPoolOrders();
  const target = orders.find((o) => o.id === orderId);
  if (!target) return false;

  target.status = "cancellation_requested";
  target.updatedAt = new Date().toISOString();
  savePoolOrder(target);
  return true;
}

export function cancelPoolOrder(orderId: string): boolean {
  const orders = getAllPoolOrders();
  const target = orders.find((o) => o.id === orderId);
  if (!target) return false;

  target.status = "cancelled";
  target.cancelledAt = new Date().toISOString();
  target.updatedAt = new Date().toISOString();
  savePoolOrder(target);
  return true;
}

export function addFundsToPoolOrder(
  orderId: string,
  additionalEthAmount: string
): PoolOrderRecord | null {
  const orders = getAllPoolOrders();
  const target = orders.find((o) => o.id === orderId);
  if (!target) return null;

  try {
    const prevWei = parseUnits(target.sellAmount, 18);
    const addWei = parseUnits(additionalEthAmount, 18);
    const newTotalWei = prevWei + addWei;
    const newTotalEth = formatUnits(newTotalWei, 18);

    target.sellAmount = newTotalEth;

    if (target.orderType === "LIMIT") {
      const quote = calculateLimitQuote(
        newTotalEth,
        target.targetPrice || "3500",
        REFERENCE_ETH_PRICE
      );
      target.estimatedOutput = quote.expectedUsdcOutput;
      target.feeAmount = quote.feeAmount;
    } else {
      const quote = calculateMarketQuote(newTotalEth, REFERENCE_ETH_PRICE);
      target.estimatedOutput = quote.estimatedUsdcOutput;
      target.feeAmount = quote.feeAmount;
    }

    target.updatedAt = new Date().toISOString();
    savePoolOrder(target);

    // Synchronize session config if currently active
    const activeConfig = loadPoolConfig();
    if (activeConfig) {
      activeConfig.sellAmount = target.sellAmount;
      activeConfig.estimatedOutput = target.estimatedOutput;
      activeConfig.feeAmount = target.feeAmount;
      savePoolConfig(activeConfig);
    }

    return target;
  } catch {
    return null;
  }
}

// --- Activity Management ---
export function loadPoolActivity(): PoolActivityItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(POOL_ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addPoolActivity(item: PoolActivityItem): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadPoolActivity();
    const filtered = current.filter((x) => x.id !== item.id);
    const updated = [item, ...filtered].slice(0, 30);
    localStorage.setItem(POOL_ACTIVITY_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

