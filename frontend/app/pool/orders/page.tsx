"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  History,
  Plus,
  Inbox,
} from "lucide-react";
import { PoolHeader } from "@/components/pool/PoolHeader";
import { PendingOrderCard } from "@/components/pool/PendingOrderCard";
import { CancelOrderModal } from "@/components/pool/CancelOrderModal";
import { PoolOrderRecord } from "@/lib/pool/types";
import {
  getAllPoolOrders,
  cancelPoolOrder,
} from "@/lib/pool/state";
import { cn } from "@/lib/utils";

type FilterTab = "ALL" | "ACTIVE" | "COMPLETED" | "CANCELLED";

export default function PoolOrdersPage() {
  const [orders, setOrders] = useState<PoolOrderRecord[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>("ACTIVE");
  const [orderToCancel, setOrderToCancel] = useState<PoolOrderRecord | null>(null);

  const refreshOrders = () => {
    setOrders(getAllPoolOrders());
  };

  useEffect(() => {
    refreshOrders();
  }, []);

  const activeCount = orders.filter(
    (o) =>
      o.orderType === "LIMIT" &&
      (o.status === "active_waiting" || o.status === "submitted" || o.status === "order_created")
  ).length;

  const filteredOrders = orders.filter((o) => {
    if (activeTab === "ALL") return true;
    if (activeTab === "ACTIVE") {
      return (
        o.orderType === "LIMIT" &&
        (o.status === "active_waiting" ||
          o.status === "submitted" ||
          o.status === "order_created" ||
          o.status === "condition_met" ||
          o.status === "executing")
      );
    }
    if (activeTab === "COMPLETED") return o.status === "completed";
    if (activeTab === "CANCELLED") return o.status === "cancelled";
    return true;
  });

  const handleCancelClick = (order: PoolOrderRecord) => {
    setOrderToCancel(order);
  };

  const handleConfirmCancel = (id: string) => {
    cancelPoolOrder(id);
    refreshOrders();
    setOrderToCancel(null);
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <PoolHeader activeOrdersCount={activeCount} backHref="/pool" />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#232B36]">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs text-[#94A3B8] uppercase tracking-wider font-semibold">
              <History size={13} className="text-[#3B82F6]" />
              <span>ENCLAVE ORDER MANAGEMENT</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F4F8] uppercase">
              POOL ORDERS DASHBOARD
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/pool"
              className="py-2.5 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 focus:outline-none shadow-lg cursor-pointer"
            >
              <Plus size={14} />
              <span>NEW POOL ORDER</span>
            </Link>
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#1C222B] border border-[#232B36] w-full sm:w-fit text-xs">
          {(["ACTIVE", "ALL", "COMPLETED", "CANCELLED"] as FilterTab[]).map((tab) => {
            const isCurrent = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "py-1.5 px-3 rounded-lg font-medium transition-all cursor-pointer",
                  isCurrent
                    ? "bg-[#161B22] text-[#F0F4F8] border border-[#232B36] shadow-sm font-bold"
                    : "text-[#94A3B8] hover:text-[#F0F4F8]"
                )}
              >
                <span>{tab}</span>
                {tab === "ACTIVE" && activeCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-[#3B82F6] text-white text-[10px] font-bold">
                    {activeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Orders Listing */}
        {filteredOrders.length === 0 ? (
          <div className="p-12 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-4 shadow-xl my-6">
            <div className="w-12 h-12 rounded-full bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#505D6E] mx-auto">
              <Inbox size={22} />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#F0F4F8]">
                No {activeTab.toLowerCase()} orders found
              </h3>
              <p className="text-xs text-[#94A3B8]">
                {activeTab === "ACTIVE"
                  ? "You have no open limit orders currently resting in the enclave book."
                  : "No historical records match this status category."}
              </p>
            </div>
            <Link
              href="/pool"
              className="inline-flex items-center gap-2 py-2 px-4 rounded-xl bg-[#3B82F6] text-white text-xs font-bold uppercase tracking-wider shadow-lg hover:bg-[#2563EB] transition-colors"
            >
              <span>CREATE AN ORDER</span>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((ord) => (
              <PendingOrderCard
                key={ord.id}
                order={ord}
                onCancelClick={handleCancelClick}
              />
            ))}
          </div>
        )}
      </main>

      {orderToCancel && (
        <CancelOrderModal
          isOpen={true}
          orderId={orderToCancel.id}
          sellAmount={orderToCancel.sellAmount}
          sellAsset={orderToCancel.sellAsset}
          targetPrice={orderToCancel.targetPrice}
          orderType={orderToCancel.orderType}
          onClose={() => setOrderToCancel(null)}
          onConfirm={handleConfirmCancel}
        />
      )}

      <footer className="border-t border-[#232B36] py-6 px-4 text-center text-xs text-[#505D6E] font-mono bg-[#12161D]">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>ORDERS REGISTRY & MONITOR</span>
        </div>
      </footer>
    </div>
  );
}
