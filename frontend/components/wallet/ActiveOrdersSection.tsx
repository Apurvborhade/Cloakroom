"use client";

import React from "react";
import Link from "next/link";
import { Clock, Plus, Inbox } from "lucide-react";
import { PoolOrderRecord } from "@/lib/pool/types";
import { ActiveOrderCard } from "./ActiveOrderCard";
import { cn } from "@/lib/utils";

interface ActiveOrdersSectionProps {
  orders: PoolOrderRecord[];
  className?: string;
}

export function ActiveOrdersSection({ orders, className }: ActiveOrdersSectionProps) {
  return (
    <div className={cn("space-y-4 font-mono text-left", className)}>
      <div className="flex items-center justify-between pb-2 border-b border-[#232B36]">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-[#F59E0B]" />
          <h3 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
            ACTIVE ORDERS ({orders.length})
          </h3>
        </div>

        <Link
          href="/pool"
          className="text-xs text-[#3B82F6] hover:text-[#60A5FA] font-semibold transition-colors flex items-center gap-1"
        >
          <Plus size={13} />
          <span>New Order</span>
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="p-8 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-3 shadow-lg">
          <div className="w-10 h-10 rounded-full bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#64748B] mx-auto">
            <Inbox size={18} />
          </div>
          <div className="text-xs font-bold text-[#F0F4F8] uppercase tracking-wider">
            NO ACTIVE ORDERS FOUND
          </div>
          <p className="text-[11px] text-[#94A3B8] max-w-sm mx-auto leading-relaxed">
            You currently have no open Market or Limit orders in the confidential matching book.
          </p>
          <div className="pt-1">
            <Link
              href="/pool"
              className="py-2 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-semibold uppercase tracking-wider transition-all inline-block shadow-md"
            >
              CREATE POOL ORDER
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <ActiveOrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}
