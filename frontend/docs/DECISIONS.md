# Frontend Architectural Decision Log

## Decision 001: Next.js App Router for Frontend Framework

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Architecture & Routing

### Context
The Cloakroom privacy protocol requires an institutional-grade, production-ready Web3 frontend with clean route transitions, fast client-side navigation, and compatibility with the monorepo structure (`packages/shared`, viem, wagmi, and future enclave attestation checks).

### Options Considered
1. **Next.js 14 App Router (React 18, TypeScript, Tailwind CSS):** Modern standard with file-based routing, nested layouts, static prerendering, and optimized client bundles.
2. **Next.js Pages Router:** Legacy Next.js architecture using `_app.tsx` and `_document.tsx`.
3. **Vite + React SPA:** Single-page application bundler without built-in server-side rendering or static page generation.

### Decision
Next.js 14 with App Router, TypeScript, and Tailwind CSS inside the dedicated `frontend/` package.

### Rationale
- Directly matches the documented stack in `docs/frontend.md` and `docs/roles/pradnyesh-frontend.md`.
- Provides built-in static page prerendering (`output: export` or static generation) for maximum performance and security (no node server attack surface).
- Clean separation between server components and client-side interactive boundaries (`"use client"`).
- Integrates seamlessly with `pnpm` workspaces alongside `@cloakroom/shared`.

### Trade-offs
- Client-only Web3 globals (`window.ethereum`) must be guarded behind `"use client"` directives and lifecycle hooks.
- Search params in static exports require `<Suspense>` boundaries to avoid build bailouts.

### Affected Files
- `frontend/package.json`
- `frontend/tsconfig.json`
- `frontend/next.config.mjs`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/app/deposit/page.tsx`

### Future Considerations
When server-side enclave verification (`GET /attestation`) is live, route handlers in `app/api/` can proxy requests through Anon-RPC oblivious relays.

---

## Decision 002: Universal Onyx Black `#0C0C0C` Global Background System

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Styling & Visual Design System

### Context
The Cloakroom brand identity is modeled after Railgun's institutional-grade DeFi privacy interface. The application must feel like confidential financial infrastructure rather than a generic crypto dashboard or marketing site. A non-negotiable global mandate requires Onyx Black `#0C0C0C` as the universal background across all routes.

### Options Considered
1. **Generic Tailwind Zinc/Neutral (`#09090b` / `#18181b`):** Common in template Web3 dashboards, lacks depth and uniqueness.
2. **Deep Slate Obsidian (`#0C0C0E`):** Original draft shade with faint blue undertone.
3. **Pure Onyx Black (`#0C0C0C`) with Layered Surfaces:** `#0C0C0C` universal background with `#141418` primary surface, `#18181D` secondary surface, `#1E1E26` elevated interactive surface, and `#A6DCF8` ice-blue cryptographic accent.

### Decision
Universal Onyx Black `#0C0C0C` enforced via CSS variables on `<html>` and `<body>` in `app/globals.css`, mapped to Tailwind tokens in `tailwind.config.ts`, and applied across all layout containers.

### Rationale
- Enforces strict visual consistency: no route or modal can inadvertently display a lighter tone.
- Maximizes contrast for white typography (`#F5F5F7`) and ice-blue accents (`#A6DCF8`).
- Restrained surfaces (`#141418`, `#18181D`) create subtle physical depth through 1px precision borders (`#292930`) without heavy drop shadows or flashy neon gradients.

### Trade-offs
- Low-contrast displays require careful border luminance (`#292930`) to keep container boundaries discernible.

### Affected Files
- `frontend/app/globals.css`
- `frontend/tailwind.config.ts`
- `frontend/app/layout.tsx`
- `frontend/app/page.tsx`
- `frontend/app/deposit/page.tsx`
- `frontend/components/Navigation.tsx`
- `frontend/components/Footer.tsx`

### Future Considerations
Revisit only if an institutional client theme or high-contrast accessibility mode is formally specified.

---

## Decision 003: HTML5 Canvas for Interactive Atomic Orbital System

- **Date:** 2026-11-06
- **Status:** Accepted (Supersedes Decision 003-A: Solid Central Obsidian Enclave)
- **Area:** Component & Performance

### Context
The hero visual represents Cloakroom's confidential execution environment. The initial implementation used a solid polygonal vault with an inward particle flow and heavy blue bloom. This was identified as overly dominant behind the headline. The requirement shifted to an elegant, open atomic orbital system: thin intersecting elliptical rings with moving particles and a quiet, empty center.

### Options Considered
1. **Three.js / WebGL Scene:** Full 3D rendering pipeline with orbit controls. Rejected due to bundle size (+600KB) and battery drain.
2. **SVG DOM Animations:** Multiple `<ellipse>` SVG elements animated with CSS. Rejected due to poor performance with dozens of particle trails and precession calculations across mobile browsers.
3. **HTML5 2D Canvas with Parametric Elliptical Geometry:** Mathematical projection of 6 independent orbital rings, precessing at distinct angular velocities, with discrete particles and phase-based depth cueing.

### Decision
Custom HTML5 Canvas component in `HeroVisual.tsx` using parametric 2D ellipse projections, coupled with a CSS perspective wrapper driven by window pointer tracking for interactive 3D tilt.

### Rationale
- 60fps hardware-accelerated canvas loop with negligible CPU footprint.
- Zero bundle dependencies (pure Canvas 2D API).
- Complete control over orbital precession, particle trails, and alpha gradients.
- Visual center remains open and quiet, allowing the headline ("Your finances. / Your privacy. / Your control.") to maintain razor-sharp legibility.
- Strict `prefers-reduced-motion` compliance freezes rotation and particle motion cleanly.

### Trade-offs
- Bitmaps require dynamic `devicePixelRatio` scaling to maintain crisp 1px strokes on Retina and high-DPI screens.

### Affected Files
- `frontend/components/HeroVisual.tsx`
- `frontend/components/HeroSection.tsx`

### Future Considerations
Can support dynamic speed modulation based on live network transaction volume or enclave attestation status.

---

## Decision 004: Direct Web3 Provider Integration via `viem` without Fabricated Balances

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** State & Web3 Integration

### Context
Financial interfaces require cryptographic truth. Mocking fake balances, dummy wallet addresses, or simulated blockchain confirmations undermines institutional credibility. Cloakroom must honestly interface with the user's real browser wallet (MetaMask, Rabby, Coinbase Wallet) while maintaining a clean disconnected fallback state.

### Options Considered
1. **Simulated Demo State:** Displaying hardcoded balances (e.g. `2.45 ETH`) regardless of connection. Rejected as misleading and unacceptable for audits.
2. **Heavy WalletConnect + RainbowKit Provider Stack:** Full modal suite requiring cloud project IDs and external telemetry. Rejected for baseline privacy (no third-party tracking per EF CROPS requirements).
3. **Lightweight Native `viem` + `useWallet` Hook:** Direct EIP-1193 interaction with `window.ethereum`, querying real on-chain balance via `eth_getBalance`, formatting with `formatEther`, and handling `accountsChanged` / `chainChanged` events.

### Decision
Custom `useWallet.ts` hook utilizing `viem` for genuine on-chain reads, formatting, and address validation, paired with a clean non-custodial `WalletModal.tsx`.

### Rationale
- Zero tracking scripts or third-party telemetry, strictly honoring EF hackathon requirements (CROPS prize).
- Reflects actual user balances: when disconnected, explicitly shows "Connect wallet to view balance".
- Native `isAddress` utility from `viem` provides EIP-55 checksum validation.

### Trade-offs
- Does not yet include embedded social logins (privy/turnkey), but aligns with Cloakroom's threat model where existing wallets sign EIP-712 envelopes.

### Affected Files
- `frontend/hooks/useWallet.ts`
- `frontend/components/WalletModal.tsx`
- `frontend/components/Navigation.tsx`
- `frontend/app/deposit/page.tsx`

### Future Considerations
Integration with `@anon-rpc/browser-harness` to proxy all `eth_getBalance` and chain reads through zero-leak RPC relays.

---

## Decision 005: Hero Section Layering and Stacking Context

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Component & Layout Architecture

### Context
The confidential visualization must sit directly behind the hero headline, description, and action buttons without interfering with click targets, text selection, or navigation links.

### Options Considered
1. **Background CSS Image:** Static or video asset. Rejected because it lacks dynamic particle motion, canvas interactivity, and responsiveness.
2. **Mixed Stacking Context in Same Container:** Visual and text interspersed in flex column. Rejected because it pushed content vertically and prevented orbital rings from framing the headline.
3. **Strict Layered Stacking Hierarchy:**
   - Layer 0 (`z-0 pointer-events-none`): Full-viewport canvas with radial gradient mask feathering.
   - Layer 2 (`z-[2] pointer-events-auto`): Hero content container with text drop-shadow contrast protection.
   - Layer 40 (`z-40`): Fixed sticky navigation bar.

### Decision
Strict three-tier stacking hierarchy (`z-0` background, `z-[2]` foreground content, `z-40` navigation) with container `overflow-hidden`.

### Rationale
- Completely eliminates pointer event hijacking: all clicks pass unhindered to CTAs.
- Canvas orbital rings extend beyond headline margins, providing physical atmospheric depth.
- Window-level pointer listener continues to drive subtle 3D perspective tilt without requiring pointer events on the canvas itself.

### Trade-offs
- Requires `overflow-hidden` on the parent `<section>` to prevent wide orbital rings from triggering horizontal scrollbars on mobile.

### Affected Files
- `frontend/components/HeroSection.tsx`
- `frontend/components/HeroVisual.tsx`
- `frontend/components/Navigation.tsx`

### Future Considerations
None; this pattern is rock-solid.



---

## Decision 006: Dual Execution Mode Selection Architecture (MIX vs POOL) & Context Forwarding

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Architecture & Component Design

### Context
Following source and destination configuration on Screen 3, users need to choose between two fundamentally distinct execution strategies: privacy-oriented pooled batch execution (`MIX`) versus conditional asset exchange (`POOL`). The interface must clearly educate the user on the differences between these modes, provide intuitive selection affordances, preserve the active session and transfer parameters, and prevent premature on-chain execution.

### Options Considered
1. **Compact Radio/Dropdown Toggle in a Single Form:** Embedding the mode toggle directly within the transfer or deposit form. Rejected because it collapses two complex workflows into a trivial toggle, failing to communicate the architectural and cryptographic differences between pooled execution and conditional order placement.
2. **Tabbed View or Accordion:** Hiding detailed descriptions and comparison attributes behind tabs. Rejected because it forces users to click back and forth to compare parameters, increasing cognitive load.
3. **Dedicated Dual Selection Cards with Integrated Comparison Matrix & Query State Forwarding:** Two equal-height cards displaying bespoke visual treatments, badges, descriptions, and feature indicators, paired with a persistent action area and comparison table.

### Decision
Option 3: Side-by-side selection cards (`ExecutionModeCard.tsx`) with dedicated minimal visual treatments (lightweight atomic orbital for MIX; directional exchange flow for POOL), accompanied by an explicit comparison matrix (`ModeComparison.tsx`) and URL query parameter state persistence.

### Rationale
- Maximizes visual clarity and cognitive comprehension: users immediately understand that this is a critical decision point.
- Differentiates the modes visually: MIX features an atomic orbital motif representing private enclave pooling; POOL features an opposing-node directional geometric flow representing asset conversion.
- Strict selection requirement: the primary `CONTINUE →` CTA remains disabled until an explicit mode is selected, preventing accidental progression.
- Context preservation: transfers all established parameters (`source`, `destination`, `asset`, `amount`, `network`) to `/mix` or `/pool` without requiring redundant re-entry.

### Trade-offs
- Requires responsive layout collapse: 2 horizontal columns on desktop collapse into a vertical stack on mobile.
- Query parameters must be safely parsed using `<Suspense>` client boundaries in Next.js.

### Affected Files
- `frontend/app/execution/page.tsx`
- `frontend/components/ExecutionModeCard.tsx`
- `frontend/components/ModeComparison.tsx`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

### Future Considerations
When Screen 5A (`/mix`) and Screen 5B (`/pool`) are implemented, the selected mode state will initiate the corresponding EIP-712 typed intent schema (`DepositRequest` vs `SwapIntent`).

---

## Decision 007: MIX Experience End-to-End State Machine, Route Architecture, and Multi-Stage Execution Pipeline

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Privacy Pooling, State Management, and Multi-Screen Journey

### Context
Following execution mode selection on Screen 4 (`/execution`), users entering the MIX flow require an end-to-end financial experience: configuring asset allocations (`/mix`), reviewing transaction terms (`/mix/review`), tracking confidential batch execution (`/mix/execution`), receiving verifiable settlement confirmation (`/mix/success`), and viewing portfolio holdings (`/wallet`). The journey must preserve state across routes, guarantee arithmetic precision for mixed token decimals (ETH 18 vs USDC 6), ensure cryptographic data integrity without fabricating mock L1 hashes or balances, and support both connected Web3 wallet authorization and offline simulation boundaries.

### Options Considered
1. **Monolithic Single-Page Modal Workflow:** Implementing setup, review, execution, and success inside modal dialogs on a single route. Rejected because it impairs browser navigation, URL sharing, deep-linking, refresh resilience, and degrades user confidence in an institutional-grade financial product.
2. **Stateless URL-Query Passing Alone:** Serializing all state strictly through URL search params. Rejected because complex execution metadata (batch IDs, execution logs, completion timestamps, and wallet activity records) exceed practical query limits and cannot persist across post-mix navigation into `/wallet`.
3. **Multi-Route Architecture with Hybrid Persistence & Pure Business Logic:** 5 discrete Next.js App Router pages (`/mix`, `/mix/review`, `/mix/execution`, `/mix/success`, `/wallet`), supported by modular presentation components (`components/mix/*`), deterministic calculation utilities (`lib/mix/calculations.ts` using `viem`), and a hybrid persistence model (`sessionStorage` for active session + `localStorage` for completed activity + URL search params for deep linking and recovery).

### Decision
Option 3: Dedicated 5-screen pipeline with modular supporting components, high-precision financial mathematics, a 7-stage execution lifecycle state machine (`preparing`, `awaiting_signature`, `submitted`, `processing`, `completed`, `failed`, `cancelled`), and direct handoff to `/wallet`.

### Rationale
- **Mathematical Precision:** Utilizing `viem` (`parseUnits`, `formatUnits`) eliminates JavaScript floating-point traps. ETH and USDC decimals are strictly handled according to token specifications.
- **Data Integrity & Non-Fabrication:** Never fabricates fake L1 transaction hashes, dummy balances, or artificial exchange rates. Explicitly distinguishes between real wallet balances from `useWallet()`, reference oracle estimates ($3,200/ETH), and confidential off-chain enclave batch execution.
- **Resilient Navigation:** Back navigation and page refreshes seamlessly restore user inputs. Arriving at `/mix/review`, `/mix/execution`, or `/mix/success` without prior context displays dedicated recovery states (`MixEmptyState.tsx`) rather than throwing runtime errors.
- **Non-Custodial Authorization:** On connected wallets, requests genuine `personal_sign` authorization of the `MixIntent` envelope, handling user rejections (code 4001) gracefully. Provides an explicit sandbox simulation fallback when no provider is connected.
- **Integrated Wallet Handoff:** Automatically files verified batch settlements into local session activity history, immediately visible in the `/wallet` portfolio breakdown.

### Trade-offs
- Requires `<Suspense>` boundaries wrapping `useSearchParams()` sync helpers on each client page to guarantee Next.js static prerendering compliance.

### Affected Files
- `frontend/app/mix/page.tsx`
- `frontend/app/mix/review/page.tsx`
- `frontend/app/mix/execution/page.tsx`
- `frontend/app/mix/success/page.tsx`
- `frontend/app/wallet/page.tsx`
- `frontend/components/mix/MixHeader.tsx`
- `frontend/components/mix/MixProgress.tsx`
- `frontend/components/mix/AssetInput.tsx`
- `frontend/components/mix/ConversionSummary.tsx`
- `frontend/components/mix/BalanceBreakdown.tsx`
- `frontend/components/mix/MixReviewSummary.tsx`
- `frontend/components/mix/MixExecutionStatus.tsx`
- `frontend/components/mix/MixEmptyState.tsx`
- `frontend/lib/mix/types.ts`
- `frontend/lib/mix/calculations.ts`
- `frontend/lib/mix/validation.ts`
- `frontend/lib/mix/state.ts`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

### Future Considerations
When live enclave endpoints (`/relay`, `/batch`) are deployed, replace the sandbox simulation timeout loop with direct HTTP/WebSocket polling to the AWS Nitro Enclave attestation server.

---

## Decision 008: Landing Page Scroll-Morph On-Chain Trade Visualization Architecture (Superseded)

- **Date:** 2026-11-06
- **Status:** Superseded / Rejected
- **Area:** Landing Page & Creative Motion Design

### Context
An experimental scroll-driven morph animation concept (Scatter → Line → Circle → Bottom Arc) featuring on-chain multi-asset trade cards was implemented in the hero section to illustrate activity across networks.

### Outcome & Rejection Rationale
Following review, the scroll-morph on-chain trade visualization was determined not to align with Cloakroom's product ethos:
1. **Design Philosophy Conflict:** Cloakroom's brand is rooted in institutional, quiet, privacy-first financial infrastructure (Railgun inspired). The multi-card animation introduced unnecessary visual clutter, distracting from the core value proposition ("Your finances. Your privacy. Your control.").
2. **Visual Purity:** The original atomic orbital Canvas visualization (`HeroVisual.tsx`) provides an elegant, restrained, and authentic cryptographic atmosphere without competing card objects.
3. **Bundle Leanliness:** Reverting the animation allowed removal of `framer-motion`, keeping client bundles minimal and dependency-free.

---

## Decision 009: Restoration of Original Atomic Orbital Landing Hero

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Landing Page Architecture

### Context
Following the evaluation and rejection of the scroll-morph card visualization (Decision 008), the landing page needed to be completely restored to its established stable architecture, visual hierarchy, and atomic orbital background system without introducing replacement experiments.

### Decision
Restore the original `HeroSection.tsx` component hierarchy:
- **Layer 0 (`z-0 pointer-events-none`):** The 6-ring 3D atomic orbital Canvas system (`HeroVisual.tsx`), centered behind the headline with subtle opacity and radial gradient feathering.
- **Layer 2 (`z-2 pointer-events-auto`):** Foreground hero content, including:
  - Top badge: `PRIVATE FINANCIAL INFRASTRUCTURE`
  - Headline: "Your finances. / Your privacy. / Your control."
  - Supporting description and dual CTAs: `START →` (routing to `/deposit`) and `Explore Protocol` (linking to `#protocol`).
  - Isolated Enclave attestation badge.
  - Technical Value Metrics Strip (Hardware TEE, HPKE Encryption, Pooled Inventory, Anon-RPC Routed).
- **Layer 40 (`z-40`):** Fixed sticky navigation bar (`Navigation.tsx`).

### Rationale
- Completely preserves the minimalist, futuristic, privacy-first DeFi interface approved in Decisions 002, 003, and 005.
- Zero scroll traps, zero artificial delays, and 100% standard viewport rendering (`min-h-[90vh]`).
- All morph-specific files (`components/ui/scroll-morph-hero.tsx`, `components/landing/*`, `lib/landing/*`) and dependencies (`framer-motion`) removed completely.

### Affected Files
- `frontend/components/HeroSection.tsx` (restored to original git HEAD baseline)
- `frontend/package.json` (removed `framer-motion`)
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

---

## Decision 010: Complete POOL Execution Experience Architecture

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** POOL Experience & Exchange Pipeline

### Context
Following execution mode selection on Screen 4 (`/execution`), users entering the POOL flow require an end-to-end conditional asset exchange experience: configuring trade parameters (`/pool`), reviewing order terms and enclave protections (`/pool/review`), tracking live order execution (`/pool/execution`), receiving verifiable settlement summaries (`/pool/success`), managing active orders (`/pool/orders`), and synchronizing holdings and activity in the wallet portfolio (`/wallet`).

### Architecture & Technical Mechanics
1. **Separation of Market and Limit Order Lifecycles:**
   - **Market Orders:** Immediate liquidity fill against private enclave pool inventory ($4,850,000 depth) with a 0.10% relayer fee (10 bps) and 0.50% guaranteed slippage protection. Progression: `preparing` → `awaiting_signature` → `submitted` → `processing` → `completed`.
   - **Limit Orders:** Conditional orders resting in confidential enclave memory. User specifies target price (e.g. $3,500 USDC / 1 ETH) with +5%, +10%, +20% quick presets and configurable expiry (24 Hours, 7 Days, Good 'til Cancelled). Progression: `order_created` → `awaiting_signature` → `submitted` → `active_waiting`. Unlike market swaps, limit orders stay in `active_waiting` indefinitely until the price condition is met or the user cancels.
2. **Deterministic Mathematical Calculations:**
   - Calculations implemented in `frontend/lib/pool/calculations.ts` using `viem` (`parseUnits`, `formatUnits`) for 18-decimal token precision to prevent JavaScript floating-point traps.
   - Reference oracle valuation established at $3,200.00 USDC per 1 ETH.
3. **Unconditional Order Cancellation Guarantee:**
   - Users maintain complete cryptographic ownership of locked assets. Active limit orders can be cancelled at any time prior to execution via `CancelOrderModal` and `cancelPoolOrder()`.
   - Cancelling immediately withdraws the order from the confidential matcher, releases locked ETH back to available balance, updates status to `cancelled`, and records the cancellation in the activity timeline.
4. **Interactive Simulation & Verification:**
   - For demo and development validation, `OrderStatusTracker` provides a dedicated `[SIMULATE TARGET HIT]` trigger when an order is in `active_waiting`, allowing instant simulation of price triggers transitioning to `condition_met` → `executing` → `completed`.
5. **Wallet Portfolio Integration (`/wallet`):**
   - Expanded portfolio view to 3 tabs:
     - `Asset Holdings`: Displays available wallet balance alongside locked ETH in active limit orders.
     - `Open Limit Orders`: Dedicated management list for active resting orders with cancellation support.
     - `Activity History`: Consolidated chronological audit trail merging both MIX privacy batches and POOL trades.
6. **Global Design System Compliance:**
   - Mandatory Onyx Black `#0C0C0C` background across every route and modal.
   - Design tokens: Primary surface `#141418`, Secondary surface `#18181D`, Elevated surface `#1E1E26`, Borders `#292930`, Primary accent `#A6DCF8`, Text `#F5F5F7` / `#92929B`.

### Affected Files
- `frontend/app/pool/page.tsx`
- `frontend/app/pool/review/page.tsx`
- `frontend/app/pool/execution/page.tsx`
- `frontend/app/pool/success/page.tsx`
- `frontend/app/pool/orders/page.tsx`
- `frontend/app/wallet/page.tsx`
- `frontend/components/pool/PoolHeader.tsx`
- `frontend/components/pool/PoolProgress.tsx`
- `frontend/components/pool/OrderTypeSelector.tsx`
- `frontend/components/pool/MarketOrderForm.tsx`
- `frontend/components/pool/LimitOrderForm.tsx`
- `frontend/components/pool/PriceInformation.tsx`
- `frontend/components/pool/OrderReviewSummary.tsx`
- `frontend/components/pool/OrderStatusTracker.tsx`
- `frontend/components/pool/CancelOrderModal.tsx`
- `frontend/components/pool/PendingOrderCard.tsx`
- `frontend/components/pool/PoolEmptyState.tsx`
- `frontend/lib/pool/types.ts`
- `frontend/lib/pool/calculations.ts`
- `frontend/lib/pool/validation.ts`
- `frontend/lib/pool/state.ts`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

---

## Decision 011: Dedicated POOL Order Status & Management Interface

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** POOL Order Monitoring, State Management, and Fund Controls

### Context
Following order configuration (`/pool`) and review verification (`/pool/review`), users require a dedicated Order Status & Management screen at `/pool/execution`. Rather than acting solely as an ephemeral spinner or duplicate trading screen, this route must serve as an active control center allowing users to monitor their order lifecycle, inspect committed vs available funds, augment order sizing (`Add Funds`), revoke active orders (`Cancel Order`), and access their overall portfolio (`/wallet`).

### Architecture & Technical Mechanics
1. **Screen Structure & Component Decomposition:**
   - **`OrderOverviewCard.tsx`:** Displays order type, pair, unique order ID with clipboard utility, creation timestamp, and visually prominent status badge supporting 12 lifecycle states (`preparing`, `awaiting_signature`, `submitted`, `processing`, `funds_reserved`, `active_waiting`, `condition_met`, `executing`, `completed`, `cancellation_requested`, `cancelled`, `failed`, `expired`).
   - **`OrderProgressTimeline.tsx`:** Sequential milestone tracker adapting strictly to order type. For Market orders: Order Prepared → Signature Requested → Submitted → Processing → Confirmed. For Limit orders: Order Created → Funds Reserved → Waiting for Target Price → Target Condition Met → Execution Initiated → Confirmed. No fabricated percentages or premature completion claims.
   - **`OrderFinancialBreakdown.tsx`:** Financial card explicitly differentiating committed ETH, expected USDC output, settled proceeds (when filled), 0.10% relayer fees, and unreserved available wallet balance directly from `useWallet()`.
   - **`OrderActionControls.tsx`:** Primary and secondary actions:
     - **Add Funds:** Accessible via `AddFundsModal` for active/cancellable orders. Validates available balance, recalculates expected quote, and updates active order record in `localStorage` and `sessionStorage`.
     - **Cancel Order:** Accessible via `CancelOrderModal` with two-phase state transition (`cancellation_requested` → `cancelled`), unreserving committed funds.
     - **Testnet Sandbox Simulation:** Dedicated developer trigger `[SIMULATE TARGET HIT]` allowing interactive condition matching in development environments.
   - **`WalletNavigationBanner.tsx`:** Clean, elevated portfolio navigation section directing users to `/wallet`.
2. **Data Integrity & Non-Fabrication Standards:**
   - Explicitly labels oracle reference rates ($3,200.00 USDC / 1 ETH) and enclave pool metrics as demo/testnet parameters.
   - Rejects claims of unverified L1 on-chain finality for client session state updates.
   - Correct token decimal handling (18 decimals for ETH, 6 decimals for USDC) utilizing `viem`.
3. **Design System Adherence:**
   - Universal Onyx Black `#0C0C0C` background.
   - Surface hierarchy: `#141418`, `#18181D`, `#1E1E26`, borders `#292930`, accents `#A6DCF8` / emerald `#34D399` / amber `#FBBF24`.

### Affected Files
- `frontend/app/pool/execution/page.tsx`
- `frontend/components/pool/OrderOverviewCard.tsx`
- `frontend/components/pool/OrderProgressTimeline.tsx`
- `frontend/components/pool/OrderFinancialBreakdown.tsx`
- `frontend/components/pool/OrderActionControls.tsx`
- `frontend/components/pool/WalletNavigationBanner.tsx`
- `frontend/components/pool/AddFundsModal.tsx`
- `frontend/components/pool/CancelOrderModal.tsx`
- `frontend/components/pool/PriceInformation.tsx`
- `frontend/lib/pool/types.ts`
- `frontend/lib/pool/state.ts`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

---

## Decision 012: Comprehensive Wallet / Portfolio Architecture & Financial Source of Truth

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Wallet, Financial Accounting, Portfolio Distribution, Cash Out

### Context
Users navigating from `/pool/execution → /wallet` require a single, trustworthy financial source of truth. The wallet must provide a complete, non-custodial accounting overview: how much ETH and USDC they currently hold, how much is unreserved and available, how much is committed to active orders, historical swap volumes, verified fees, and a prominent `Cash Out` action leading to the planned exit gateway.

### Architecture & Technical Mechanics
1. **Component Decomposition (Anti-Monolith):**
   - **`components/wallet/WalletHeader.tsx`:** Manages identity, network detection, address copying, and working on-chain balance refresh.
   - **`components/wallet/PortfolioOverview.tsx`:** High-level valuation card showing total estimated USD value, available vs allocated split, and primary `Cash Out` trigger.
   - **`components/wallet/AssetBalanceCard.tsx`:** Dedicated asset cards for ETH (18 decimals) and USDC (6 decimals) with expandable accounting details.
   - **`components/wallet/PortfolioDistribution.tsx`:** Segmented distribution bar with proportional percentages and numerical capital breakdown.
   - **`components/wallet/ActiveOrdersSection.tsx` & `ActiveOrderCard.tsx`:** Active orders list with status badges and deep-linking to `/pool/execution?orderId=...`.
   - **`components/wallet/RecentActivity.tsx`:** Unified activity ledger merging POOL market/limit orders and MIX privacy batches with status filters.
   - **`components/wallet/FinancialSummary.tsx`:** Concise ledger table for the 8 core financial metrics.
   - **`components/wallet/CashOutModal.tsx`:** Modal communicating the planned availability status of the `/wallet/withdraw` route without fabricating transactions.
2. **Strict Financial Accounting & Non-Fabrication Standards:**
   - **Zero Double-Counting:** Available on-chain EOA balance (`useWallet()`) and committed order allocations are strictly segregated (`Total ETH = Available + Allocated`).
   - **Truthful Proceeds:** Expected swap outputs are never counted as settled proceeds until confirmed completed.
   - **Honest Unavailable States:** Historical deposits or withdrawals that cannot be verified on-chain are marked `Unavailable` rather than guessing zero.
   - **Correct Token Decimals:** 18 decimals for ETH, 6 decimals for USDC.
3. **Design System Adherence:**
   - Universal Onyx Black `#0C0C0C` background across the entire wallet screen.
   - Restrained surfaces (`#141418`, `#18181D`), subtle `#292930` borders, and `#A6DCF8` primary accent.

### Affected Files
- `frontend/app/wallet/page.tsx`
- `frontend/components/wallet/WalletHeader.tsx`
- `frontend/components/wallet/PortfolioOverview.tsx`
- `frontend/components/wallet/AssetBalanceCard.tsx`
- `frontend/components/wallet/PortfolioDistribution.tsx`
- `frontend/components/wallet/ActiveOrdersSection.tsx`
- `frontend/components/wallet/ActiveOrderCard.tsx`
- `frontend/components/wallet/RecentActivity.tsx`
- `frontend/components/wallet/FinancialSummary.tsx`
- `frontend/components/wallet/CashOutModal.tsx`
- `frontend/lib/pool/state.ts`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

---

## Decision 013: Cash Out / Withdrawal Interface Architecture & Non-Custodial Exit Gateway Boundary

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Cash Out / Withdrawal Gateway, Balance Accounting, Blockchain Integrity

### Context
Users navigating from `/wallet` require a secure, production-grade interface at `/wallet/withdraw` to configure and review asset withdrawals (ETH and USDC) back to their connected Web3 wallet (EOA). The interface must provide transparent asset selection, decimal validation, destination address verification, real-time fee breakdown, and a comprehensive confirmation review modal. Crucially, because the Layer-1 Cash-Out / Exit Gateway smart contract is currently undergoing formal security audit, the interface must strictly preserve cryptographic integrity: it must never fabricate fake gas estimates, mock transaction hashes, or render an unverified "Payment Successful" screen.

### Architecture & Technical Mechanics
1. **Asset Selection & Non-Fabricated Accounting:**
   - **ETH Balance:** Derives strictly from the connected wallet's live on-chain balance (`eth_getBalance` via `useWallet()`). Excludes ETH committed to active limit orders.
   - **USDC Balance:** Derives strictly from confirmed completed proceeds across `poolActivity` and `mixActivity`. Unverified expected quotes are excluded.
   - **Zero Double-Counting:** `Total Capital = Available + Allocated`.
2. **Input Handling & Decimal Precision Rules:**
   - Enforces EVM decimal boundaries: maximum 18 decimals for ETH, maximum 6 decimals for USDC.
   - Provides a one-click `MAX` button that computes exact available funds without floating-point precision errors.
   - Real-time USD conversion referencing the standard demo oracle benchmark ($3,200.00 / ETH).
3. **Destination Wallet Verification:**
   - Automatically resolves to the user's connected Web3 EOA with one-click clipboard copying and checksum display.
   - Clarifies that funds exit Cloakroom's settlement pool directly to this user-controlled destination.
4. **Transparent Fee & Network Disclosure:**
   - Discloses 0.00% gateway protocol fee during the testnet milestone.
   - Explicitly displays `Estimated L1 Gas Fee: Not available (Pending contract audit)`. No synthetic gas numbers or fake Gwei estimations are fabricated.
5. **Review Modal & Critical Blockchain Boundary:**
   - Primary CTA `Review Withdrawal` opens `WithdrawalReviewModal`.
   - Embeds a prominent security banner: `"Verify your destination address and network before proceeding. Blockchain transactions may be irreversible."`
   - Explicitly displays an audit advisory: `"The Layer-1 Cash Out / Exit Gateway smart contract is currently undergoing formal security audit and Nitro Enclave attestation testing. On-chain transaction execution is disabled in this testnet milestone. No funds have been moved."`
   - Disables the execution button with label `EXECUTION CURRENTLY UNAVAILABLE`.
   - Never simulates transaction hashes, block confirmations, or premature Payment Successful screens.
6. **Universal Visual & Design System Adherence:**
   - Onyx Black `#0C0C0C` background with subtle borders (`#292930`) and surface hierarchy (`#141418`, `#18181D`).
   - Clear responsive two-column layout on desktop, stacked on mobile.

### Affected Files
- `frontend/app/wallet/withdraw/page.tsx`
- `frontend/components/wallet/withdraw/WithdrawalHeader.tsx`
- `frontend/components/wallet/withdraw/WithdrawalBalanceOverview.tsx`
- `frontend/components/wallet/withdraw/WithdrawalAssetSelector.tsx`
- `frontend/components/wallet/withdraw/WithdrawalAmountInput.tsx`
- `frontend/components/wallet/withdraw/WithdrawalDestination.tsx`
- `frontend/components/wallet/withdraw/WithdrawalFeeBreakdown.tsx`
- `frontend/components/wallet/withdraw/WithdrawalSummary.tsx`
- `frontend/components/wallet/withdraw/WithdrawalReviewModal.tsx`
- `frontend/components/wallet/withdraw/WithdrawalReview.tsx`
- `frontend/components/wallet/PortfolioOverview.tsx`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`

---

## Decision 014: On-Chain Withdrawal Success Verification & Settlement Confirmation Architecture

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Payment Confirmation, Cryptographic Verification, Exit Gateway

### Context
Following a withdrawal request, financial clarity requires a final confirmation screen at `/wallet/withdraw/success` proving that funds have settled. In accordance with institutional DeFi standards, this screen must display "Payment Successful" strictly when an actual on-chain transaction receipt has been verified as successful (`status === 0x1`). A successful wallet signature or mempool broadcast alone is insufficient to declare success. In the absence of a live on-chain execution contract (due to ongoing security audit), the screen's UI must be verified via an isolated development fixture, while keeping the production route inaccessible without genuine verified transaction receipts.

### Architecture & Technical Mechanics
1. **Cryptographic Success Verification Gate:**
   - Evaluates incoming transaction hashes via `eth_getTransactionReceipt` using the connected Web3 provider (`window.ethereum` / `viem`).
   - Requires receipt confirmation with EVM status `0x1` (success).
   - Strictly prohibits rendering "Payment Successful" for signed-only, submitted-only, pending (`receipt.blockNumber === null`), reverted (`status === 0x0`), or missing transactions.
2. **Deterministic Non-Success State Machine (`WithdrawalSuccessStates.tsx`):**
   - **`loading`:** Displays an active cryptographic synchronization indicator.
   - **`pending`:** Renders a pending status banner with link to the block explorer and re-check action while awaiting block mining.
   - **`failed`:** Displays a transaction reverted warning with error rationale and return controls.
   - **`missing`:** Gated boundary preventing direct route visits without a transaction hash from displaying unearned success.
   - **`invalid`:** Enforces standard 32-byte hex hash format validation (`^0x[a-fA-F0-9]{64}$`).
   - **`unsupported_network`:** Alerts users on unverified chains and requests switching to Sepolia or Mainnet.
3. **Receipt-Derived Financial Metrics:**
   - All displayed metrics originate strictly from verified receipt data: transferred amount, recipient destination, timestamp, and gas fees.
   - Actual L1 network gas fee is computed directly from receipt metrics: `(gasUsed * effectiveGasPrice)` converted to ETH via `formatEther`.
   - Distinguishes L1 gas fees from protocol fees (`0.00%`).
4. **Secure Explorer URL Resolution:**
   - Generates explorer links strictly against trusted network configurations (Mainnet, Sepolia, Holesky).
   - Prohibits constructing links to arbitrary or user-supplied external domains. If an explorer cannot be determined, links are safely omitted.
5. **Gated Development Preview Fixture:**
   - Isolated fixture available strictly in non-production environments (`process.env.NODE_ENV !== "production"` via `preview=true`).
   - Displays a prominent amber watermark: `DEV PREVIEW FIXTURE — L1 GATEWAY IN SECURITY AUDIT — NOT A REAL ON-CHAIN WITHDRAWAL`.
   - Never accessible in production builds.
6. **Integration Blocker Transparency:**
   - Explicitly records that live L1 gateway execution is undergoing formal security audit.
   - Preserves `/wallet/withdraw` execution button in its locked state (`EXECUTION CURRENTLY UNAVAILABLE`).

### Affected Files
- `frontend/app/wallet/withdraw/success/page.tsx`
- `frontend/components/wallet/withdraw/success/PaymentSuccessHeader.tsx`
- `frontend/components/wallet/withdraw/success/SuccessAmountCard.tsx`
- `frontend/components/wallet/withdraw/success/TransactionDetailsCard.tsx`
- `frontend/components/wallet/withdraw/success/DestinationAddress.tsx`
- `frontend/components/wallet/withdraw/success/TransactionHash.tsx`
- `frontend/components/wallet/withdraw/success/TransactionFeeBreakdown.tsx`
- `frontend/components/wallet/withdraw/success/SuccessActions.tsx`
- `frontend/components/wallet/withdraw/success/WithdrawalSuccessStates.tsx`
- `frontend/lib/wallet/verification.ts`
- `frontend/docs/DECISIONS.md`
- `frontend/docs/FLOW.md`






---

## Decision 015: NONY Brand Transformation & Swiss International Light Theme Architecture

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Visual Identity, Typography, Design System & Theming

### Context
The application was previously named CLOAKROOM. The product has been formally rebranded to **NONY**, embodying clean, institutional, privacy-preserving financial infrastructure. Rather than an incremental CSS adjustment or dark-theme restyling, the user and protocol direction demanded a total ground-up aesthetic transformation: scrapping the dark/neon crypto aesthetic and replacing it with an authoritative, restrained **Swiss International / Precision Fintech** light theme as the universal default across all 16 application routes and components.

### Architectural Decisions
1. **Brand Standard:**
   - Universal product name is **NONY** across every screen, header, badge, footer, intent message, and modal.
   - Restyled shield emblem logo with slate/steel-blue geometry replacing former dark or neon marks.
2. **Light Design Token System:**
   - Background Canvas: Pure soft off-white `#F7F8FA`
   - Primary Surface: Clean crisp white `#FFFFFF`
   - Structural Borders: Precision border `#E3E6EB` with subtle soft elevation (`shadow-sm`)
   - Primary Text: High-contrast rich charcoal `#17191D` (WCAG AAA compliant, contrast ratio > 11:1)
   - Secondary / Subtext: Steel neutral `#626A75` (contrast ratio > 5.5:1)
   - Muted / Disabled: Cool gray `#9299A3`
   - Primary Accent: Precision Steel Blue `#377FA5` with soft tint `#E7F3FA`
   - Semantic Success: Deep forest green `#21865B` with soft emerald tint `bg-emerald-50` / `border-emerald-200`
   - Semantic Warning: Amber `#B45309` / `bg-amber-50`
   - Semantic Error: Red `#DC2626` / `bg-red-50`
3. **Impeccable & Craft-Floor Adherence:**
   - Applied principles from `impeccable` workflow (v4.1.1): strict typography hierarchy, intentional spacing (4px/8px modular scale), no generic purple or neon glows, no fake floating orbs, and meaningful interactive component states.
4. **Complete Screen Coverage:**
   - Rebuilt all 16 screens: Landing (`/`), Deposit (`/deposit`), Transfer (`/transfer`), Execution Selection (`/execution`), MIX Setup (`/mix`), MIX Review (`/mix/review`), MIX Execution (`/mix/execution`), MIX Success (`/mix/success`), POOL Trading (`/pool`), POOL Review (`/pool/review`), POOL Order Status (`/pool/execution`), POOL Success (`/pool/success`), POOL Orders (`/pool/orders`), Wallet Portfolio (`/wallet`), Cash Out (`/wallet/withdraw`), and Payment Successful (`/wallet/withdraw/success`).

### Affected Files
- `frontend/tailwind.config.ts`
- `frontend/app/globals.css`
- `frontend/app/layout.tsx`
- `frontend/components/Logo.tsx`
- `frontend/components/Navigation.tsx`
- `frontend/components/Footer.tsx`
- `frontend/components/WalletModal.tsx`
- `frontend/components/AttestationBadge.tsx`
- All 16 application pages and associated component directories.

---

## Decision 016: ETH-First Asset Architecture & Reusable AssetSelector Implementation

- **Date:** 2026-11-06
- **Status:** Accepted
- **Area:** Asset Architecture, Financial State, Decimal Precision

### Context
In prior prototypes, disparate asset pickers existed across pages, occasionally presenting placeholder tokens (such as BTC, SOL, or DAI) that the underlying smart contracts and enclave matching engine do not support. Furthermore, user requirements mandated an **ETH-First** policy: Ethereum (ETH) must be the default selected asset across all trading, mixing, and withdrawal flows, displaying exact 18-decimal precision for ETH and 6-decimal precision for USDC.

### Architectural Decisions
1. **Strictly Supported Assets:**
   - Protocol supports strictly **ETH** (Native Layer-1, 18 decimals) and **USDC** (ERC-20, 6 decimals).
   - All unsupported placeholder tokens (BTC, SOL, DAI) were purged from functional dropdowns and asset selectors.
2. **Standardized Shared `AssetSelector` Component:**
   - Created `frontend/components/AssetSelector.tsx`.
   - Triggers as `[ ETH icon ] ETH ▼` button displaying the active token symbol, icon, and chevron.
   - Dropdown menu reveals only verified supported tokens with their name, symbol, type badge ("Native Layer 1" vs "ERC-20"), live balance, and active selection indicator.
   - Integrated full accessibility: keyboard navigation (Enter, Space, Escape, Arrow Up/Down), outside-click dismissal, ARIA attributes (`aria-haspopup`, `aria-expanded`).
3. **Dynamic Decimals and Input Synchronization:**
   - When switching between ETH and USDC, amount fields automatically clamp decimal places (18 for ETH, 6 for USDC).
   - Real-time USD conversion recalculates against oracle benchmark rates.
   - Preserves state across route transitions through persistent local session storage.

### Affected Files
- `frontend/components/AssetSelector.tsx`
- `frontend/components/pool/MarketOrderForm.tsx`
- `frontend/components/pool/LimitOrderForm.tsx`
- `frontend/components/mix/AssetInput.tsx`
- `frontend/components/wallet/withdraw/WithdrawalAssetSelector.tsx`
- `frontend/components/wallet/withdraw/WithdrawalBalanceOverview.tsx`
