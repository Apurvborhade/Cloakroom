# Frontend Execution Flow & Traceability

This document traces the live execution flow of the Cloakroom web application. It maps entry points, component composition, state lifecycles, navigation transitions, and failure modes across implemented screens.

---

## High-Level Application Architecture

```text
CLOAKROOM FRONTEND (D:\Cloakroom\frontend)
│
├── Global Providers & Shell
│   ├── app/layout.tsx              (Viewport, Inter font, Onyx Black #0C0C0C root)
│   ├── app/globals.css             (Design tokens, scrollbar, motion queries)
│   └── hooks/useWallet.ts          (EIP-1193 provider listener, viem balance read)
│
├── Screen 1: Landing Page (Route: `/`)
│   ├── app/page.tsx
│   ├── components/Navigation.tsx   (Brand, AttestationBadge, WalletModal)
│   ├── components/HeroSection.tsx  (Hero headline, value props, metrics strip)
│   │   ├── components/HeroVisual.tsx (Atomic orbital Canvas layer, z-0)
│   │   ├── Primary CTA (START →)  (Smooth client router.push to `/deposit`)
│   │   └── Secondary CTA (Explore Protocol) (Anchor scroll to `#protocol`)
│   ├── components/ProtocolSection.tsx (3 Architecture pillars, interactive tabs)
│   └── components/Footer.tsx       (Technical repository and documentation links)
│
├── Screen 2: Deposit Setup (Route: `/deposit`)
│   ├── app/deposit/page.tsx
│   ├── Top Navigation              (Compact brand, Private Session badge, Back link)
│   ├── Asset Selector              (ETH / USDC / DAI selection, state: selectedAsset)
│   ├── Amount Input                (Numerical parsing, validation, MAX balance action)
│   ├── Session Custody Panel       (Single-use enclave address reservation state)
│   ├── Security Information Panel  (Nitro TEE, Asset, Network, 15:00 TTL)
│   ├── Primary Action (CONTINUE →) (Validation check → Confirmation Modal)
│   └── Confirmation Modal          (Review summary → Session initiation dispatch)
│
└── Future Screens (Planned & In-Progress)
    ├── Screen 3: Transfer Configuration (`/transfer`)
    └── Screen 4: Execution Strategy Selection (`/execution`)
```

---

## Flow Update 001: Landing Page to Deposit Setup Conversion

- **Date:** 2026-11-06
- **Affected Screen:** Screen 1 (Landing Page `/`) → Screen 2 (Deposit Setup `/deposit`)
- **Status:** Implemented

### Entry Point
User opens `http://localhost:3000/` and clicks the primary **`START →`** button in the hero section.

### Execution Sequence
1. `app/layout.tsx` mounts the global shell with `#0C0C0C` background and loads the Inter typeface.
2. `app/page.tsx` renders:
   - `<Navigation />`: Checks `window.ethereum` via `useWallet()`, sets connection state, and renders `<AttestationBadge />`.
   - `<HeroSection />`:
     - Mounts `<HeroVisual isBackground />` at `z-0` inside a pointer-events-none container.
     - Canvas loop starts: 6 intersecting elliptical orbits precess with independent angular velocities while discrete particles circulate along paths.
     - Pointer movements across `window` trigger linear interpolation updates to `mousePos`, subtly rotating the CSS 3D perspective wrapper.
     - Renders headline, description, and action buttons at `z-[2]`.
3. User clicks `START →`:
   - `handleStartClick(e)` intercepts default navigation.
   - Sets `isNavigating = true`, applying a subtle scale and opacity transition (`opacity-75 scale-[0.98]`).
   - Dispatches `router.push('/deposit')` after a 280ms transition window.
4. Client navigates to `/deposit`, rendering Screen 2.

### State and Data Flow
- **Local State (`HeroSection.tsx`):**
  - `isNavigating` (`boolean`): Triggers visual feedback on click.
- **Canvas Internal State (`HeroVisual.tsx`):**
  - `mousePos` (`{ x, y }`): 3D perspective coordinates.
  - `time` (`number`): Monotonic tick advancing orbital precession and particle phases.
  - `particles` (`IngressParticle[]`): Phase positions, speeds, micro-trails.
- **Data Movement:**
  - Route transition carries no URL query parameters initially; clean entry into `/deposit`.

### Modified Components
- `components/HeroSection.tsx`: `handleStartClick()`, stacking hierarchy.
- `components/HeroVisual.tsx`: `resize()`, `render()`, window pointer listeners.

### Failure Points
- Next.js router failure: Fallback anchor `href="/deposit"` guarantees native browser navigation even if client-side router is delayed.
- Reduced motion preference: Automatically freezes Canvas animation and 3D tilt if `prefers-reduced-motion` is detected.

### Verification
- Tested on Chromium and mobile viewports.
- Click on `START →` transitions smoothly to `/deposit` within 300ms.

---

## Flow Update 002: Screen 2 Deposit Session Initialization

- **Date:** 2026-11-06
- **Affected Screen:** Screen 2 (Deposit Setup `/deposit`)
- **Status:** Implemented

### Entry Point
User enters `/deposit` either via direct URL or via `START →` from the hero section.

### Execution Sequence
1. `app/deposit/page.tsx` mounts:
   - Reads wallet connection state from `useWallet()`.
   - Initializes `selectedAsset = "ETH"`, `amount = ""`, `sessionInitialized = false`.
2. User selects an asset (`ETH`, `USDC`, `DAI`):
   - Updates `selectedAsset`.
   - Resets `amount` to prevent invalid decimal carry-over.
3. User enters an amount:
   - `handleAmountChange(e)` verifies decimal format (`/^\d*\.?\d*$/`).
   - Restricts decimals to asset precision (18 for ETH/DAI, 6 for USDC).
   - Real-time check evaluates `isInsufficient = (numericAmount > numericBalance)`.
4. User clicks `MAX`:
   - `handleMaxClick()` checks `account`. If disconnected, opens `<WalletModal />`.
   - If connected and `selectedAsset === "ETH"`, reserves a `0.005 ETH` gas buffer and sets `amount`.
5. User clicks `CONTINUE →`:
   - Guard condition checks `isAmountValid && !isInsufficient`.
   - Opens the `<ConfirmDepositSessionModal />` preview.
6. User reviews summary and clicks `INITIATE SESSION`:
   - Sets `isSubmitting = true` (shows spinning loader).
   - In production: POSTs payload to enclave `/deposit-session` endpoint.
   - Enclave assigns an ephemeral custody address (`0x71C568a8F9B60471f54aC482C400cCE9C298B319`).
   - Sets `sessionInitialized = true` and displays the reserved address with copy/QR actions.

### State and Data Flow
- **`selectedAsset` (`AssetSymbol`):** Current active token (ETH, USDC, DAI).
- **`amount` (`string`):** User numerical string input.
- **`sessionInitialized` (`boolean`):** Toggles between setup form and active session deposit view.
- **`generatedAddress` (`string | null`):** The enclave-assigned single-use custody EOA.
- **`confirmModalOpen` (`boolean`):** Controls transaction preview dialog visibility.

### Modified Components
- `app/deposit/page.tsx`: Main page component, validation logic, session dispatch handler.
- `hooks/useWallet.ts`: Supplies real account, network, and ETH balance.

### Failure Points
- Wallet Disconnected: `CONTINUE` button displays `CONNECT WALLET TO DEPOSIT` and opens `WalletModal`.
- Insufficient Balance: Input border turns red, button disables, and inline warning is displayed.
- Invalid Number: Prevents non-numeric input and multiple decimals.

### Verification
- Tested input validation with 0, negative values, letters, and excessive decimals.
- Verified balance display against connected MetaMask wallet on Sepolia.
- Verified copy-to-clipboard functionality.

---

## Flow Update 003: Non-Custodial Web3 Wallet State & Balance Resolution

- **Date:** 2026-11-06
- **Affected Components:** `hooks/useWallet.ts`, `components/WalletModal.tsx`, `components/Navigation.tsx`
- **Status:** Implemented

### Entry Point
Page mount or user clicking `Connect Wallet` in the navigation bar.

### Execution Sequence
1. `useWallet()` executes `refreshWalletState()` on mount:
   - Queries `window.ethereum.request({ method: "eth_accounts" })`.
   - Queries `window.ethereum.request({ method: "eth_chainId" })`.
2. If accounts exist:
   - Sets `account` to active address.
   - Maps `chainId` to human-readable network name (Mainnet, Sepolia, Holesky, etc.).
   - Dispatches `eth_getBalance` for the account, formatting with `formatEther` to 4 decimal places.
3. Event listeners attached:
   - `accountsChanged`: Updates active account or clears state on disconnect.
   - `chainChanged`: Updates network name and re-queries balance.
4. User clicks `Connect Wallet`:
   - Opens `WalletModal`.
   - User clicks `Browser Wallet` -> calls `eth_requestAccounts`.
   - Updates state on approval; displays clear error message on rejection.

### State and Data Flow
- **State returned by `useWallet()`:**
  ```ts
  {
    account: string | null;
    chainId: number | null;
    networkName: string;
    balance: string | null;
    isConnecting: boolean;
    error: string | null;
    connect: () => Promise<boolean>;
    refreshBalance: () => void;
  }
  ```

### Modified Components
- `hooks/useWallet.ts`
- `components/WalletModal.tsx`
- `components/Navigation.tsx`

### Failure Points
- No provider installed: Shows informative message ("Install MetaMask, Rabby, or Coinbase Wallet").
- User rejects request: Captures error code 4001 and surfaces readable notification.
- RPC read timeout: Silently handles balance query failure without breaking the UI.

### Verification
- Verified account switching and network switching with MetaMask.
- Verified disconnected state on clean browser session.

---

## Flow Update 004: Screen 4 Execution Strategy Mode Selection (MIX vs POOL)

- **Date:** 2026-11-06
- **Affected Components:** `app/execution/page.tsx`, `components/ExecutionModeCard.tsx`, `components/ModeComparison.tsx`
- **Status:** Implemented

### Entry Point
User navigates to `/execution` from Screen 3 (`/transfer`) or directly via deep-link.

```text
Screen 3 — Transfer Configuration (/transfer)
          |
          v (query params: ?asset, amount, source, destination, network)
Screen 4 — Execution Mode Selection (/execution)
          |
          |---- Select MIX ──> Highlights MIX card, activates CTA
          |       |
          |       v [CONTINUE TO MIX]
          |     /mix (Screen 5A — Planned)
          |
          |---- Select POOL ──> Highlights POOL card, activates CTA
                  |
                  v [CONTINUE TO POOL]
                /pool (Screen 5B — Planned)
```

### Execution Sequence
1. `app/execution/page.tsx` mounts:
   - `ExecutionParamsSync` inside `<Suspense>` parses query parameters: `asset`, `amount`, `source`, `destination`, `network`, `mode`.
   - Defaults applied if not provided (`ETH`, `1.0`, enclave session custody address, recipient EOA, `Sepolia`).
   - If query string already contains `mode=MIX` or `mode=POOL`, initializes `selectedMode` automatically (preserving user choice when returning via browser back button).
2. Screen 4 Interface Renders:
   - **Header:** CLOAKROOM logo, `PRIVATE SESSION` pulsing indicator, `PROTOCOL`, `DOCUMENTATION`, wallet connection button (`WalletModal`), and `← TRANSFER` back link preserving transfer context.
   - **Three-Step Progress Indicator:**
     - `1. DEPOSIT ✓` (Completed, emerald checkmark, links back to `/deposit`)
     - `2. TRANSFER ✓` (Completed, emerald checkmark, links back to `/transfer?...`)
     - `3. EXECUTION` (Active, `#A6DCF8` highlight with active node dot)
   - **Session Context Strip:** Concise summary displaying configured amount, asset, source EOA, recipient EOA, and active network, with an `Edit Transfer` link.
   - **Page Intro:** Eyebrow `03 / EXECUTION STRATEGY`, headline `Choose how you execute.`, and clear supporting description.
   - **Dual Execution Mode Cards:**
     - **MIX:** Badge `PRIVATE EXECUTION`, 3-ring atomic orbital canvas visual, clear descriptions, capabilities list (`Pooled execution workflow`, `Private balance management`, `Dedicated stake interface`), and selection affordance.
     - **POOL:** Badge `CONDITIONAL EXECUTION`, directional geometric exchange canvas visual (opposing ETH/USDC nodes with flow particle track), capabilities list (`ETH / USDC exchange interface`, `Market execution`, `Limit execution with configurable price conditions`), and selection affordance.
   - **Comparison Matrix (`ModeComparison.tsx`):**
     - Detailed side-by-side comparison across Primary purpose, Interface, Asset interaction, and Next step without unsupported marketing hype.
     - Responsive design: clean tabular format on desktop; stacked responsive cards on mobile viewports.
   - **Persistent Bottom Action Bar:**
     - Unselected state: Displays `Select an execution mode to continue.` with disabled `CONTINUE →` button.
     - Selected state: Displays active strategy indicator (`SELECTED STRATEGY: MIX/POOL`), destination route notice, and enables `CONTINUE TO [MODE] →`.
3. User selects an Execution Strategy:
   - Clicking either card triggers `setSelectedMode("MIX")` or `setSelectedMode("POOL")`.
   - Card displays `#A6DCF8` border, subtle ambient glow, and checked indicator.
   - Bottom action bar immediately enables and updates label.
4. User clicks `CONTINUE TO [MODE] →`:
   - Compiles search parameters: `?asset=${asset}&amount=${amount}&source=${source}&destination=${destination}&network=${network}&mode=${selectedMode}`.
   - If MIX: Dispatches client navigation to `/mix?...` (Screen 5A — Planned).
   - If POOL: Dispatches client navigation to `/pool?...` (Screen 5B — Planned).
   - Prevents double-clicks with `isNavigating` spinner state.

### State and Data Flow
- **`asset` (`string`):** Carried forward token symbol (e.g. `ETH`, `USDC`, `DAI`).
- **`amount` (`string`):** Carried forward deposit quantity.
- **`sourceAddress` (`string`):** Origin EOA (enclave session custody address or user wallet).
- **`destinationAddress` (`string`):** Target recipient address.
- **`network` (`string`):** Active network name (Sepolia, Mainnet, etc.).
- **`selectedMode` (`"MIX" | "POOL" | null`):** Current strategy selection.
- **`isNavigating` (`boolean`):** Route transition lock.

### Modified Components
- `frontend/app/execution/page.tsx`: Main route page, state management, parameter synchronization, sticky action bar.
- `frontend/components/ExecutionModeCard.tsx`: Reusable mode selection card with custom Canvas visualizations for MIX (orbital) and POOL (exchange).
- `frontend/components/ModeComparison.tsx`: Responsive comparison grid and stacked mobile view.

### Failure Points
- Missing Parameters: Gracefully falls back to valid default session parameters rather than erroring out or displaying empty values.
- Unselected Mode: Bottom button is disabled and displays a clear prompt preventing progression.
- Double-clicks: Navigation handler is guarded by `isNavigating` state.

### Verification
- TypeScript typecheck passed cleanly (`pnpm typecheck`, exit code 0).
- Production build passed (`pnpm build`, 7/7 static pages prerendered).
- Verified responsive stacking on mobile and side-by-side desktop view.

---

## Flow Update 005: Complete MIX Experience User Journey (Setup → Review → Execution → Completion → Wallet)

- **Date:** 2026-11-06
- **Affected Components:**
  - `app/mix/page.tsx`
  - `app/mix/review/page.tsx`
  - `app/mix/execution/page.tsx`
  - `app/mix/success/page.tsx`
  - `app/wallet/page.tsx`
  - `components/mix/*` (`MixHeader`, `MixProgress`, `AssetInput`, `ConversionSummary`, `BalanceBreakdown`, `MixReviewSummary`, `MixExecutionStatus`, `MixEmptyState`)
  - `lib/mix/*` (`types.ts`, `calculations.ts`, `validation.ts`, `state.ts`)
- **Status:** Implemented

### User Journey Sequence

```text
Screen 4 — Execution Strategy (/execution)
          |
          v [CONTINUE TO MIX]
Screen 5A — MIX Setup (/mix)
          |  - Configure ETH/USDC commit amount
          |  - Calculate dynamic 0.10% relay fee and estimated oracle allocation
          |  - Validate against live wallet balance
          |
          v [CONTINUE TO REVIEW]
Screen 5B — MIX Review (/mix/review)
          |  - Inspect full transaction parameters, recipient EOA, and terms
          |  - Preserves back-to-edit capability
          |
          v [CONFIRM & PROCEED TO EXECUTION]
Screen 5C — MIX Execution (/mix/execution)
          |  - 7-Stage state machine: preparing -> awaiting_signature -> submitted -> processing -> completed
          |  - Prompts real wallet personal_sign (handles 4001 user rejection) with simulation boundary fallback
          |
          v [VIEW COMPLETION SUMMARY]
Screen 5D — MIX Completion (/mix/success)
          |  - Verified settlement confirmation with Enclave Batch ID
          |  - Zero public footprint guarantee
          |
          v [VIEW IN WALLET]
Screen 5E — Wallet Overview (/wallet)
             - Live portfolio balance calculation (ETH live read + shielded USDC balance)
             - Visual asset allocation bar
             - Verifiable session activity history
```

### Route-by-Route Breakdown

#### 1. Screen 5A — MIX Setup (`/mix`)
- **Entry Point:** Arrives from `/execution?mode=MIX` with URL query parameters (`asset`, `amount`, `source`, `destination`, `network`).
- **Page Component:** `frontend/app/mix/page.tsx`
- **Supporting Components:** `MixHeader`, `MixProgress` (Step 1 active), `AssetInput`, `ConversionSummary`, `BalanceBreakdown`.
- **Functions Called:**
  - `calculateMixQuote()`: Deterministically calculates fee (10 bps = 0.10%) and estimated output ($3,200 reference rate).
  - `validateMixAmount()`: Validates numeric format, token decimals (18 for ETH, 6 for USDC), and prevents exceeding live balance.
  - `calculateRemainingBalance()`: Live calculation of remaining funds after commitment.
  - `saveMixConfig()`: Persists verified configuration into `sessionStorage`.
- **Transitions:** Navigates to `/mix/review?...` upon clicking `CONTINUE TO REVIEW`.

#### 2. Screen 5B — MIX Review (`/mix/review`)
- **Entry Point:** Arrives from `/mix` with serialized config or direct deep-link.
- **Page Component:** `frontend/app/mix/review/page.tsx`
- **Supporting Components:** `MixHeader`, `MixProgress` (Step 2 active), `MixReviewSummary`, `MixEmptyState`.
- **State Handling:** Restores `MixConfig` from `sessionStorage` or constructs from query parameters. If no configuration exists, renders `MixEmptyState` with a link to restart setup.
- **Transitions:**
  - `BACK TO EDIT`: Routes back to `/mix?...` preserving all values.
  - `CONFIRM & PROCEED TO EXECUTION`: Advances to `/mix/execution?...`.

#### 3. Screen 5C — MIX Execution (`/mix/execution`)
- **Entry Point:** Arrives from `/mix/review`.
- **Page Component:** `frontend/app/mix/execution/page.tsx`
- **Supporting Components:** `MixHeader`, `MixProgress` (Step 3 active), `MixExecutionStatus`, `MixEmptyState`.
- **Execution State Machine:**
  - `preparing`: Configures ephemeral session bounds and allocates batch ID (`ENCLAVE-MIX-...`).
  - `awaiting_signature`: Checks for connected Web3 provider (`window.ethereum`). If connected, prompts `personal_sign` for the `MixIntent` envelope. If user rejects (error code 4001), transitions to `cancelled`. If no wallet is connected, transitions cleanly via the sandbox simulation harness.
  - `submitted`: Enqueues into the enclave batch pool.
  - `processing`: Simulates time-delayed enclave randomized custody batching (2.6s).
  - `completed`: Saves `MixExecutionRecord` to `sessionStorage` and appends completed record to `localStorage` activity history via `saveMixExecution()`.
- **Transitions:** On completion, enables `VIEW COMPLETION SUMMARY` which navigates to `/mix/success`.

#### 4. Screen 5D — MIX Completion (`/mix/success`)
- **Entry Point:** Arrives from `/mix/execution` upon verified completion.
- **Page Component:** `frontend/app/mix/success/page.tsx`
- **Supporting Components:** `MixHeader`, `MixProgress` (Step 4 active), `MixEmptyState`.
- **Data Integrity Display:**
  - Renders final executed amount, net shielded allocation, and protocol fee.
  - Shows Enclave Batch ID with one-click copy.
  - Explicitly notes: "Zero Public Footprint: Transaction was batch-relayed off-chain inside the confidential AWS Nitro Enclave to preserve transaction anonymity."
- **Transitions:** `VIEW IN WALLET` routes to `/wallet`; `NEW MIX` routes to `/mix`.

#### 5. Screen 5E — Wallet Overview (`/wallet`)
- **Entry Point:** Arrives from `/mix/success` or top navigation.
- **Page Component:** `frontend/app/wallet/page.tsx`
- **Features:**
  - **Portfolio Valuation:** Calculates live portfolio total: `(live ETH balance * $3,200) + shielded USDC balance`.
  - **Asset Allocation Bar:** Proportional distribution visual (ETH% vs USDC%).
  - **Holdings Tab:** Card breakdown for Ethereum (live wallet balance) and USD Coin (shielded enclave balance).
  - **Activity History Tab:** Reads `loadMixActivity()` and lists verified session batch settlements with timestamps, recipient EOAs, and batch IDs.
  - **Withdraw Modal:** Accessible via `CASH OUT / WITHDRAW` for generating enclave exit proofs.

### Verification Results
- `pnpm typecheck`: Exit code 0, zero errors.
- `pnpm build`: 12/12 static pages generated successfully (routes: `/`, `/deposit`, `/transfer`, `/execution`, `/mix`, `/mix/review`, `/mix/execution`, `/mix/success`, `/wallet`).

---

## Flow Update 006: Landing Page Scroll-Morph On-Chain Trade Visualization (Reverted)

- **Date:** 2026-11-06
- **Status:** Reverted / Superseded
- **Note:** The experimental scroll-morph on-chain trade animation was evaluated and completely removed to restore the original atomic orbital landing-page design.

---

## Flow Update 007: Restored Landing Page Architecture & Atomic Orbital System

- **Date:** 2026-11-06
- **Affected Components:**
  - `app/page.tsx`
  - `components/HeroSection.tsx`
  - `components/HeroVisual.tsx`
  - `components/Navigation.tsx`
  - `components/ProtocolSection.tsx`
  - `components/Footer.tsx`
- **Status:** Implemented (Restored Stable Baseline)

### Landing Page Component Hierarchy

```text
LandingPage (app/page.tsx)
├── Navigation (components/Navigation.tsx)
│   ├── Logo ("CLOAKROOM")
│   ├── Protocol & How It Works anchor links
│   ├── Documentation external link
│   ├── AttestationBadge (AWS Nitro TEE PCR0 enclave verification)
│   └── Wallet connection button (triggers WalletModal)
│
├── main
│   ├── HeroSection (components/HeroSection.tsx)
│   │   ├── Layer 0 (z-0 pointer-events-none):
│   │   │   └── HeroVisual.tsx (Interactive 6-ring 3D atomic orbital Canvas)
│   │   │
│   │   └── Layer 2 (z-2 pointer-events-auto):
│   │       ├── Category Pill: "PRIVATE FINANCIAL INFRASTRUCTURE"
│   │       ├── Main Headline:
│   │       │   ├── "Your finances."
│   │       │   ├── "Your privacy."
│   │       │   └── "Your control."
│   │       ├── Supporting Description
│   │       ├── CTAs:
│   │       │   ├── Primary CTA: "START →" (Routes to /deposit)
│   │       │   └── Secondary CTA: "Explore Protocol" (Anchor to #protocol)
│   │       ├── Technical Attestation Badge (Isolated Enclave)
│   │       └── Technical Value Metrics Strip:
│   │           ├── Custody Architecture (Hardware TEE)
│   │           ├── Request Sealing (HPKE Encryption)
│   │           ├── Intent Execution (Pooled Inventory)
│   │           └── RPC Obfuscation (Anon-RPC Routed)
│   │
│   └── ProtocolSection (components/ProtocolSection.tsx)
│       ├── Architecture Pillars (TEE Enclave, HPKE, Dark Liquidity)
│       └── Technical Specifications tabbed interface
│
└── Footer (components/Footer.tsx)
```

### Execution Flow & Interaction
1. **Initial Mount:**
   - Universal Onyx Black `#0C0C0C` background renders immediately.
   - `HeroVisual.tsx` Canvas initializes with 6 precessing elliptical rings, moving particles, and an understated quiet focal center.
   - Mouse movement drives subtle 3D tilt perspective via window pointer events without intercepting clicks or scroll.
2. **User Interactions:**
   - Clicking `START →`: Initiates smooth transition to Screen 2 (`/deposit`).
   - Clicking `Explore Protocol`: Scrolls smoothly to `#protocol`.
   - Clicking `Connect Wallet`: Opens non-custodial `WalletModal`.
3. **Scroll Flow:**
   - Normal native page scroll without any wheel-trapping, sticky morph delays, or card clutter.

### Verification Results
- `pnpm typecheck`: Exit code 0, zero errors.
- `pnpm build`: 12/12 static pages prerendered successfully (Route `/`: 10.4 kB).

---

## Flow Update 008: Complete POOL Experience Pipeline

- **Date:** 2026-11-06
- **Affected Routes & Components:**
  - `app/pool/page.tsx` (Screen 6: Main Trading Interface)
  - `app/pool/review/page.tsx` (Screen 7: Order Review)
  - `app/pool/execution/page.tsx` (Screen 8: Execution & Live Tracking)
  - `app/pool/success/page.tsx` (Screen 9: Completion Summary)
  - `app/pool/orders/page.tsx` (Orders Dashboard)
  - `app/wallet/page.tsx` (Updated Portfolio Overview)
  - `components/pool/*` (`PoolHeader`, `PoolProgress`, `OrderTypeSelector`, `MarketOrderForm`, `LimitOrderForm`, `PriceInformation`, `OrderReviewSummary`, `OrderStatusTracker`, `CancelOrderModal`, `PendingOrderCard`, `PoolEmptyState`)
  - `lib/pool/*` (`types.ts`, `calculations.ts`, `validation.ts`, `state.ts`)
- **Status:** Implemented and Verified

### End-to-End User Journey Diagram

```text
Screen 4 — Execution Strategy (/execution)
          |
          v [Select POOL Mode]
Screen 6 — POOL Trading Interface (/pool)
          |  - Toggle MARKET vs LIMIT orders
          |  - Sell ETH amount input + balance validation
          |  - For Limit: Target USDC price input with presets (+5%, +10%, +20%) & expiry
          |  - Live Oracle Reference rate ($3,200/ETH) & enclave liquidity depth
          |
          v [REVIEW ORDER]
Screen 7 — POOL Order Review (/pool/review)
          |  - Detailed trade breakdown (amounts, fees, conditions, addresses)
          |  - Enclave privacy guarantees (zero public mempool footprint)
          |
          v [AUTHORIZE ORDER]
Screen 8 — POOL Execution & Live Tracking (/pool/execution)
          |
          +---> [MARKET ORDER FLOW]
          |       preparing -> awaiting_signature -> submitted -> processing -> completed
          |       |
          |       v [VIEW TRADE SUMMARY]
          |     Screen 9 — POOL Completion (/pool/success)
          |
          +---> [LIMIT ORDER FLOW]
                  order_created -> awaiting_signature -> submitted -> active_waiting
                  |
                  +---> Resting in Enclave Book (active_waiting)
                  |     |
                  |     +---> [SIMULATE TARGET HIT] (Testing)
                  |     |       condition_met -> executing -> completed
                  |     |       |
                  |     |       v [VIEW TRADE SUMMARY]
                  |     |     Screen 9 — POOL Completion (/pool/success)
                  |     |
                  |     +---> [CANCEL ORDER]
                  |     |       CancelOrderModal -> Funds unlocked -> Status: cancelled
                  |     |
                  |     +---> [VIEW ORDERS DASHBOARD] (/pool/orders)
                  |             Manage all resting limit orders
                  |
                  v
Portfolio Overview (/wallet)
  - Tab 1: Asset Holdings (Wallet Balance + Locked ETH in Active Orders)
  - Tab 2: Open Limit Orders (Active resting orders with cancellation trigger)
  - Tab 3: Activity History (Consolidated chronological audit trail of MIX & POOL trades)
```

### Order Lifecycle State Machines

#### 1. Market Swap Lifecycle
1. `preparing`: Initializes trading session, verifies balances, queries reference oracle ($3,200.00).
2. `awaiting_signature`: Solicits wallet signature to authorize allocation.
3. `submitted`: Ingests intent into hardware-isolated Secure Enclave.
4. `processing`: Atomically matches order against $4,850,000 private enclave pool inventory with 0.10% fee and 0.50% slippage threshold.
5. `completed`: Credits destination address; outputs settlement reference hash; transitions to `/pool/success`.

#### 2. Limit Conditional Order Lifecycle
1. `order_created`: Prepares encrypted order parameters with user's target price and expiry condition.
2. `awaiting_signature`: Cryptographically authorizes the limit allocation.
3. `submitted`: Transmits order directly to the enclave matchmaker without public mempool leak.
4. `active_waiting`: Order sits encrypted in enclave memory monitoring oracle prices. **Does not redirect to success.** Remains active and manageable.
5. `condition_met`: Oracle price triggers condition (ETH >= Target).
6. `executing`: Enclave clears atomic swap trade.
7. `completed`: Settle destination address and archive order as filled.
8. `cancelled`: User initiated cancellation; withdraws order from matcher and releases locked funds back to available balance.

### Verification Results
- `pnpm exec tsc --noEmit`: Exit code 0, zero type errors.
- `next build`: 17/17 static pages compiled and optimized cleanly without runtime errors or prerender bailouts.

---

## Flow Update 009: Dedicated POOL Order Status & Management Pipeline

- **Date:** 2026-11-06
- **Affected Route:** `app/pool/execution/page.tsx`
- **Supporting Components:**
  - `components/pool/OrderOverviewCard.tsx`
  - `components/pool/OrderProgressTimeline.tsx`
  - `components/pool/OrderFinancialBreakdown.tsx`
  - `components/pool/OrderActionControls.tsx`
  - `components/pool/WalletNavigationBanner.tsx`
  - `components/pool/AddFundsModal.tsx`
  - `components/pool/CancelOrderModal.tsx`
  - `components/pool/PoolEmptyState.tsx`
  - `lib/pool/state.ts`
  - `lib/pool/types.ts`
- **Status:** Implemented and Verified

### Complete Interaction Flow

```text
/pool (Screen 6: Configure)
    │
    ▼
/pool/review (Screen 7: Verify terms)
    │
    ▼
/pool/execution (Dedicated Order Status & Management)
    ├── A. Header (POOL Section & Stage 3 Indicator)
    ├── B. Order Overview (ID, Pair, Type, Prominent Status, Allocation, Benchmark, Expected Output)
    ├── C. Order Progress Timeline (Exact non-fabricated stage milestones for Market or Limit)
    ├── D. Financial Breakdown (Committed Asset vs Expected Output vs Relayer Fee vs Unreserved Wallet Balance)
    ├── E. Management Actions
    │     ├── [ADD FUNDS] ────────► AddFundsModal (Validates wallet balance, recalculates quote, updates order)
    │     ├── [CANCEL ORDER] ─────► CancelOrderModal (cancellation_requested ──► cancelled, unreserves funds)
    │     ├── [SIMULATE TARGET] ──► Testnet Simulator (condition_met ──► executing ──► completed)
    │     └── [VIEW SUMMARY] ─────► /pool/success (When completed)
    │
    └── F. Wallet Navigation Banner (Your Portfolio)
          │
          ▼
    /wallet (Consolidated portfolio overview: Holdings, Open Orders, Combined History)
```

### State Transitions & Data Sources
1. **Order Creation & Retrieval:**
   - Navigating from `/pool/review` loads session config and generates initial `PoolOrderRecord` saved in `localStorage`.
   - Navigating directly with `?orderId=...` resolves the persistent record from `getPoolOrderById()`.
   - Direct access with missing parameters displays `PoolEmptyState` without runtime exceptions.
2. **Order Modification (`Add Funds`):**
   - Reads live wallet balance via `useWallet()`.
   - Validates input using `validatePoolSellAmount()`.
   - Executes `addFundsToPoolOrder()`, which performs BigInt token arithmetic (`viem`), updates `sellAmount`, recalculates output quote, updates `localStorage` and `sessionStorage`, and re-renders the financial breakdown immediately.
3. **Order Revocation (`Cancel Order`):**
   - Active orders transition through `cancellation_requested` while broadcasting revocation, then settle into `cancelled`.
   - Unreserves the committed asset and archives the cancellation into activity history.
   - Prevents cancellation once an order is in `executing` or `completed` states.
4. **Data Integrity & Non-Fabrication:**
   - Clearly labels all demo benchmarks (`Demo Oracle Reference`).
   - Distinguishes committed funds from available wallet balances.
   - Does not fabricate L1 on-chain finality for client session state updates.

### Verification Results
- `pnpm exec tsc --noEmit`: Exit code 0, zero type errors.
- `next build`: 17/17 static pages compiled and optimized cleanly without errors.

---

## Flow Update 010: Complete Wallet / Portfolio Flow

- **Date:** 2026-11-06
- **Affected Route:** `app/wallet/page.tsx`
- **Supporting Components:**
  - `components/wallet/WalletHeader.tsx`
  - `components/wallet/PortfolioOverview.tsx`
  - `components/wallet/AssetBalanceCard.tsx`
  - `components/wallet/PortfolioDistribution.tsx`
  - `components/wallet/ActiveOrdersSection.tsx`
  - `components/wallet/ActiveOrderCard.tsx`
  - `components/wallet/RecentActivity.tsx`
  - `components/wallet/FinancialSummary.tsx`
  - `components/wallet/CashOutModal.tsx`
  - `lib/pool/state.ts`
- **Status:** Implemented and Verified

### Complete Interaction Flow

```text
/pool/execution (Order Status & Management)
        │
        ▼ [Click 'View Wallet' / Bottom Portfolio Banner]
/wallet (Comprehensive Portfolio & Financial Overview)
    ├── A. Wallet Header
    │     ├── Identity & Network Badge
    │     ├── Address Copy Interaction
    │     └── Balance Refresh Action (Live Provider Query)
    │
    ├── B. Portfolio Overview Card
    │     ├── Total Estimated Valuation (USD)
    │     ├── Available vs Allocated Split (Zero Double-Counting)
    │     └── [CASH OUT] ──────► CashOutModal (Informs user of planned /wallet/withdraw route)
    │
    ├── C. Asset Holdings (Dedicated Cards)
    │     ├── ETH Card: Total, Available, Allocated, Purchased, Disbursed (18 Decimals)
    │     └── USDC Card: Total, Available, Settled Proceeds (6 Decimals)
    │
    ├── D. Portfolio Breakdown (Distribution Bar & Metrics)
    │     └── Available ETH vs Allocated Order Capital vs Settled USDC Proceeds
    │
    ├── E. Active Orders Section
    │     └── Resting Market & Limit Orders with deep link to /pool/execution?orderId=...
    │
    ├── F. Recent Activity Ledger
    │     └── Filterable Chronological History: POOL Trades + MIX Privacy Batches
    │
    └── G. Financial Summary Ledger Table
          └── 8 Verifiable Metrics: Deposited, Swapped, Purchased, Remaining, Fees, Withdrawn
```

### Data Sources & Balance Accounting
1. **Live On-Chain Balance:** ETH available balance is queried directly via `eth_getBalance` on the connected Web3 provider (`window.ethereum`) and formatted using `viem`.
2. **Active Order Capital:** Computed from active Market and Limit orders in `localStorage` (`getActivePoolOrders()`). Funds committed to active orders are distinctly counted as `Allocated` and added to `Available` to compute `Total ETH Holdings`. They are never counted as both available and allocated.
3. **Settled Proceeds:** USDC balance is derived strictly from confirmed completed trades in `poolActivity` and `mixActivity`. Expected quotes are never treated as settled capital.
4. **Cash Out Navigation:** The prominent `Cash Out` action displays a transparent modal disclosing that `/wallet/withdraw` is currently in audit and scheduled for the mainnet contract release, preventing false claims of an active withdrawal bridge.

### Verification Results
- `pnpm exec tsc --noEmit`: Exit code 0, zero type errors.
- `next build`: 17/17 static pages compiled and optimized cleanly without errors.

---

## Flow Update 011: Complete Cash Out / Withdrawal Flow (/wallet → /wallet/withdraw)

- **Date:** 2026-11-06
- **Affected Route:** `app/wallet/withdraw/page.tsx`
- **Supporting Components:**
  - `components/wallet/withdraw/WithdrawalHeader.tsx`
  - `components/wallet/withdraw/WithdrawalBalanceOverview.tsx`
  - `components/wallet/withdraw/WithdrawalAssetSelector.tsx`
  - `components/wallet/withdraw/WithdrawalAmountInput.tsx`
  - `components/wallet/withdraw/WithdrawalDestination.tsx`
  - `components/wallet/withdraw/WithdrawalFeeBreakdown.tsx`
  - `components/wallet/withdraw/WithdrawalSummary.tsx`
  - `components/wallet/withdraw/WithdrawalReviewModal.tsx`
  - `components/wallet/withdraw/WithdrawalReview.tsx`
  - `components/wallet/PortfolioOverview.tsx`
- **Status:** Implemented and Verified

### Complete Interaction Flow

```text
/wallet (Portfolio Overview)
       │
       ▼ [Click 'CASH OUT' in Portfolio Overview]
/wallet/withdraw (Cash Out / Withdrawal Screen)
       ├── 1. WithdrawalHeader
       │     ├── [← WALLET] Back Navigation Link
       │     ├── CLOAKROOM Branding
       │     ├── 'CASH OUT GATEWAY' Status Badge
       │     └── Connected Web3 EOA Pill (with one-click copy)
       │
       ├── 2. Balance Overview & Asset Selector
       │     ├── ETH Card: Live On-Chain Balance via eth_getBalance (18 Decimals)
       │     └── USDC Card: Settled Proceeds from Completed Swaps/Batches (6 Decimals)
       │
       ├── 3. Amount Entry & Validation
       │     ├── Numerical Input with Decimal Enforcement (18 for ETH, 6 for USDC)
       │     ├── Real-time USD Conversion ($3,200/ETH Demo Oracle Rate)
       │     ├── [25%] [50%] [75%] [100% / MAX] Quick Allocation Selectors
       │     └── Dynamic Inline Errors (Insufficient Balance, Decimal Limits)
       │
       ├── 4. Destination Address Confirmation
       │     ├── Default: Connected EOA Address with Checksum & One-Click Copy
       │     ├── Active Network Verification (Sepolia / Mainnet)
       │     └── External Settlement Notice
       │
       ├── 5. Fee Breakdown Card
       │     ├── Protocol Fee: 0.00% (Testnet Phase)
       │     ├── Execution Network Indicator
       │     └── Estimated Network Gas Fee: "Not available (Pending contract audit)"
       │
       ├── 6. Real-time Summary Card
       │     ├── Asset & Amount Summary
       │     ├── Security Notice: "Verify your destination address and network..."
       │     └── [REVIEW WITHDRAWAL] Primary CTA (Active when valid)
       │
       ▼ [Click 'Review Withdrawal']
WithdrawalReviewModal
       ├── Modal Header: 'CONFIRM WITHDRAWAL REQUEST'
       ├── Full Parameters Breakdown (Asset, Amount, USD, Destination, Network, Fees)
       ├── Mandatory Security Warning Notice
       ├── Critical Audit Banner: 'ON-CHAIN WITHDRAWAL GATEWAY IN AUDIT'
       │     "The Layer-1 Cash Out / Exit Gateway smart contract is currently undergoing
       │      formal security audit and Nitro Enclave attestation testing. On-chain transaction
       │      execution is disabled in this testnet milestone. No funds have been moved."
       ├── Disabled Execution CTA: [🔒 EXECUTION CURRENTLY UNAVAILABLE]
       └── [RETURN TO CONFIGURATION] / [CLOSE] Dismissal Controls
```

### Critical Blockchain Boundary Guarantees
1. **No Fabricated Gas Fees:** Live network fee shows "Not available (Pending contract audit)" instead of synthesized gas numbers.
2. **No Fake Transaction Hashes:** The modal never invents dummy transaction hashes (e.g., `0xabc...123`).
3. **No Premature Payment Success:** The screen does not advance to an unverified or simulated "Payment Successful" screen.
4. **Execution Lock:** The final on-chain withdrawal execution button remains strictly disabled (`EXECUTION CURRENTLY UNAVAILABLE`) until the L1 exit gateway contract completes audit and deployment.

### Verification Results
- `tsc --noEmit --project tsconfig.json`: Exit code 0, zero type errors.
- `next build`: 18/18 static pages prerendered successfully including `/wallet/withdraw` (9.35 kB).

---

## Flow Update 012: Payment Successful Confirmation & On-Chain Receipt Verification Flow

- **Date:** 2026-11-06
- **Affected Route:** `app/wallet/withdraw/success/page.tsx`
- **Supporting Components:**
  - `components/wallet/withdraw/success/PaymentSuccessHeader.tsx`
  - `components/wallet/withdraw/success/SuccessAmountCard.tsx`
  - `components/wallet/withdraw/success/TransactionDetailsCard.tsx`
  - `components/wallet/withdraw/success/DestinationAddress.tsx`
  - `components/wallet/withdraw/success/TransactionHash.tsx`
  - `components/wallet/withdraw/success/TransactionFeeBreakdown.tsx`
  - `components/wallet/withdraw/success/SuccessActions.tsx`
  - `components/wallet/withdraw/success/WithdrawalSuccessStates.tsx`
  - `lib/wallet/verification.ts`
- **Status:** Implemented and Verified (UI complete with strict cryptographic receipt verification gate)

### Complete User Journey & Verification Pipeline

```text
/wallet (Portfolio Overview)
       │
       ▼ [Click 'CASH OUT']
/wallet/withdraw (Withdrawal Configuration)
       │
       ▼ [Click 'REVIEW WITHDRAWAL']
WithdrawalReviewModal (Terms & Audit Notice)
       │
       ▼ [On-Chain Execution Gate: Contract currently in security audit]
         - Production State: Execution disabled ([🔒 EXECUTION CURRENTLY UNAVAILABLE])
         - Future On-Chain State: User signs tx -> Tx submitted to mempool -> Mined block
       │
       ▼ [Receipt Verification Pipeline]
/wallet/withdraw/success?txHash=...
       ├── Step 1: Format Validation
       │     └── Validates 32-byte hex string (^0x[a-fA-F0-9]{64}$)
       │           └── Fail: Displays 'Invalid Transaction Hash' (State 6)
       │
       ├── Step 2: Query eth_getTransactionReceipt & eth_getTransactionByHash
       │     ├── Receipt is null / unmined:
       │     │     └── Displays 'Transaction Pending' (State 3, with explorer link & polling)
       │     ├── Receipt status === '0x0' (Reverted):
       │     │     └── Displays 'Transaction Reverted' (State 4, failure notice & retry)
       │     ├── Unsupported network:
       │     │     └── Displays 'Unsupported Network' (State 7, Sepolia/Mainnet switch prompt)
       │     └── Direct route access without tx:
       │           └── Displays 'No Verified Transaction Context' (State 5)
       │
       └── Step 3: Verified Success (Receipt status === '0x1')
             ├── PaymentSuccessHeader: 'CONFIRMED RECEIPT' status badge
             ├── SuccessAmountCard:
             │     ├── Status badge: 'Confirmed on-chain'
             │     ├── Transferred Amount: e.g. 0.2500 ETH (Primary visual element)
             │     └── USD Valuation: Based on verified reference benchmark
             ├── TransactionDetailsCard:
             │     ├── Status: Confirmed (0x1)
             │     ├── Asset & Amount
             │     ├── Destination: Shortened EOA with copy action
             │     ├── Network: Verified active chain
             │     ├── Transaction Hash: Shortened with one-click copy & explorer link
             │     ├── Network Gas Fee: (gasUsed * effectiveGasPrice) in ETH
             │     └── Timestamp: Verified block confirmation time
             ├── TransactionFeeBreakdown:
             │     ├── Gas units consumed
             │     ├── Effective gas price (Gwei)
             │     ├── Total L1 gas fee
             │     └── Protocol fee: 0.00%
             └── SuccessActions:
                   ├── [BACK TO WALLET] (Refreshes on-chain wallet balance & routes to /wallet)
                   ├── [VIEW TRANSACTION] (Opens explorer link on verified network)
                   └── [Return to Home]
```

### Critical Blockchain Boundary Guarantees
1. **Never Treat Wallet Signature as Success:** A signed or submitted transaction alone does not unlock the Payment Successful screen. Only a confirmed receipt with status `0x1` verified via RPC unlocks the screen.
2. **Deterministic Fallbacks:** Pending, reverted, invalid, or missing transaction contexts display distinct, unambiguous state screens (`WithdrawalSuccessStates`).
3. **No Fabricated Data in Production:** All displayed fields originate strictly from on-chain receipt data. In development mode, isolated preview fixtures carry an unmistakable top watermark banner.
4. **Explorer Safety:** Links are generated strictly for known, trusted network explorers (Etherscan, Sepolia, Holesky) and never construct links to arbitrary domains.

### Verification Results
- `tsc --noEmit --project tsconfig.json`: Exit code 0, zero type errors.
- `next build`: 19/19 static pages prerendered successfully including `/wallet/withdraw/success` (9.16 kB).









---

## Flow Update 013: Complete NONY Product Redesign & Swiss Light Theme Architecture

- **Date:** 2026-11-06
- **Status:** Implemented and Verified
- **Scope:** Complete Frontend Rebuild across all 16 Screens

### User Journey Map & Route Architecture

```text
                                  [ LANDING (/) ]
                           NONY Financial Infrastructure
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
          [ DEPOSIT (/deposit) ]                     [ TRANSFER (/transfer) ]
          Enclave Escrow Setup                       Relayed Private Transfer
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                             [ EXECUTION (/execution) ]
                             Select Execution Strategy
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
         === MIX WORKFLOW ===                        === POOL WORKFLOW ===
        [/mix] Setup Batch                           [/pool] Market / Limit Trade
        [/mix/review] Review Quote                   [/pool/review] Review Order
        [/mix/execution] Anonymity Batch             [/pool/execution] Order Status & Manage
        [/mix/success] Settled Batch                 [/pool/success] Fill Confirmation
                   │                                 [/pool/orders] Orders History
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                             [ WALLET (/wallet) ]
                             Consolidated Portfolio
                                         │
                                         ▼ [CASH OUT]
                        [ WITHDRAWAL (/wallet/withdraw) ]
                        Select Asset (ETH default) & Dest
                                         │
                                         ▼ [Verified On-Chain Receipt]
                     [ SUCCESS (/wallet/withdraw/success) ]
                     Cryptographic Settlement Confirmation
```

### Key Architectural Highlights
1. **Brand Identity:** Renamed everywhere from CLOAKROOM to **NONY**.
2. **Visual Theme:** Default Precision Swiss Light Theme (`#F7F8FA` canvas, `#FFFFFF` surfaces, `#E3E6EB` borders, `#17191D` text, `#377FA5` steel blue accent).
3. **Asset Experience:** Dedicated `AssetSelector` component defaulting to ETH (18 decimals) with USDC (6 decimals) option.
4. **Zero Fabrication:** Honest on-chain statements, verifiable gas calculations, no fake transactions.
