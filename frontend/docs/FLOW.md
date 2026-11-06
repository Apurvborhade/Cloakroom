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
