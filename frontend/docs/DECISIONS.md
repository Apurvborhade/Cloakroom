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
