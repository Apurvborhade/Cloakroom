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
    <div className="min-h-screen bg-[#F7F8FA] text-[#17191D] flex flex-col selection:bg-[#377FA5]/15 selection:text-[#17191D]">
      {/* Header */}
      <PoolHeader activeOrdersCount={activeCount} backHref="/pool" />

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 font-mono">
        {/* Top Title & Action Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#E3E6EB]">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs text-[#626A75] uppercase tracking-wider font-semibold">
              <History size={13} className="text-[#377FA5]" />
              <span>ENCLAVE ORDER MANAGEMENT</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#17191D] uppercase">
              POOL ORDERS DASHBOARD
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/pool"
              className="py-2.5 px-4 rounded-xl bg-[#17191D] hover:bg-[#2B303B] text-white font-semibold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 focus:outline-none shadow-sm"
            >
              <Plus size={14} />
              <span>NEW POOL ORDER</span>
            </Link>
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F0F2F5] border border-[#E3E6EB] w-full sm:w-fit text-xs">
          {(["ACTIVE", "ALL", "COMPLETED", "CANCELLED"] as FilterTab[]).map((tab) => {
            const isCurrent = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "py-1.5 px-3 rounded-lg font-medium transition-all",
                  isCurrent
                    ? "bg-white text-[#17191D] border border-[#E3E6EB] shadow-xs font-semibold"
                    : "text-[#626A75] hover:text-[#17191D]"
                )}
              >
                <span>{tab}</span>
                {tab === "ACTIVE" && activeCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-[#E7F3FA] text-[#377FA5] text-[10px] font-bold">
                    {activeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Orders Listing */}
        {filteredOrders.length === 0 ? (
          <div className="p-12 rounded-2xl bg-white border border-[#E3E6EB] text-center space-y-4 shadow-sm my-6">
            <div className="w-12 h-12 rounded-full bg-[#F7F8FA] border border-[#E3E6EB] flex items-center justify-center text-[#9299A3] mx-auto">
              <Inbox size={22} />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#17191D]">
                No {activeTab.toLowerCase()} orders found
              </h3>
              <p className="text-xs text-[#626A75]">
                {activeTab === "ACTIVE"
                  ? "You have no open limit orders currently resting in the enclave book."
                  : "No historical records match this status category."}
              </p>
            </div>
            <Link
              href="/pool"
              className="inline-flex items-center gap-2 py-2 px-4 rounded-xl bg-[#17191D] text-white text-xs font-semibold uppercase tracking-wider shadow-sm hover:bg-[#2B303B] transition-colors"
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

      {/* Cancellation Confirmation Modal */}
      {orderToCancel && (
        <CancelOrderModal
          isOpen={!!orderToCancel}
          orderId={orderToCancel.id}
          sellAmount={orderToCancel.sellAmount}
          sellAsset={orderToCancel.sellAsset}
          targetPrice={orderToCancel.targetPrice}
          orderType={orderToCancel.orderType}
          onClose={() => setOrderToCancel(null)}
          onConfirm={handleConfirmCancel}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-[#E3E6EB] py-6 px-4 text-center text-xs text-[#9299A3] font-mono">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>ORDERS REGISTRY</span>
        </div>
      </footer>
    </div>
  );
}
