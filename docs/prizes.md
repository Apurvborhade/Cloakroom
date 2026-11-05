# Prize integrations

Two prize targets, each wired into the real flow so neither is a bolt-on. We are [not entering the Chainlink prize](decisions/2026-11-06-0358-drop-chainlink-cre.md). Requirements are from the [ETHGlobal Mumbai prizes page](https://ethglobal.com/events/mumbai/prizes).

| Prize | What to build | Evidence to ship | Watch out | Lead |
| --- | --- | --- | --- | --- |
| Uniswap Foundation, Build with Uniswap ($10,000 pool) | Swap execution through the Uniswap API and router from custody EOAs | Public open-source repo, `FEEDBACK.md`, completed [Uniswap feedback form](https://developers.uniswap.org/hackathon-feedback) with the file link, README pointing to the integration code lines | Submissions without the feedback file are audited before winners are set | Apurva builds, Pradnyesh submits |
| Ethereum Foundation, Anon-RPC ($5,000), with CROPS ($3,500) as backup | Frontend sends its chain reads through Anon-RPC by default | Demo showing reads going through it, plus a list of any traffic left out and why | Judges score how much traffic uses it. EF places a project in at most one EF prize. CROPS needs a README section titled CROPS plus an open-source licence | Pradnyesh |

## Ethereum Foundation strategy

**Target Anon-RPC, and enter CROPS as the backup.** We can submit to both, but EF places a project in at most one prize.

These details come from a summary of the prizes page, not its exact text. Check the wording on the live page before submitting.

### Anon-RPC

**Qualifies if:** the app routes its RPC reads through Anon-RPC by default.

**Judged on:**

- Works end to end in the demo
- Quality of the UX
- Share of app traffic routed through Anon-RPC
- Whether it could ship after the hackathon
- Technical depth

**Our weak spot is traffic share.** Most chain reads happen in the enclave (watcher, inventory, executor), and the browser makes only a few. Leaving traffic out is accepted if it is disclosed, so:

- Route every browser read through Anon-RPC: balances, token data and payout receipts.
- Consider showing payout status from the chain instead of the API, so more reads go through it.
- List the enclave's reads and any other excluded traffic in the README, with the reason.

**Resources:** [homepage and demo](https://ethereum.github.io/anon-rpc/), [wallet and app guide](https://ethereum.github.io/anon-rpc/wallets/), [network guide](https://ethereum.github.io/anon-rpc/networks/), [repo](https://github.com/ethereum/anon-rpc), [`@anon-rpc/browser-harness`](https://www.npmjs.com/package/@anon-rpc/browser-harness).

### CROPS (backup)

**Qualifies if:**

- The repo is public, under a free and open-source licence, with run instructions in the README.
- The README has a section titled CROPS, with one or two lines per letter:
  - **C:** what we control that users depend on (domain, server, RPC, relayer), and what happens if it goes away or refuses them.
  - **O:** the licence, and whether someone can build and run it from the repo alone.
  - **P:** what each third party (server, RPC provider, analytics, indexers) learns about the user.
  - **S:** how keys and user data are protected, and the trust assumptions.
- The demo video runs 3 minutes or less and shows the lead property working end to end, including the moment it matters.
- The client has no third-party trackers or analytics.
- Keys and personal data stay on the user's device, or the README explains why not.

**Judged on:**

- Works end to end in the demo
- Depth of the lead property, where structural (works without you) beats cosmetic (a setting)
- The other three properties still hold, or the trade-offs are stated
- UX
- Whether it could ship after the hackathon

**Weak spots to state openly:** a single operator's enclave holds every key, so custody is not on the user's device, and users lose access to funds if that node goes away.

[What CROPS means](https://blog.ethereum.org/2026/03/13/ef-mandate)

## Repo hygiene for both

- Public repo from the first commit
- A licence file (MIT or Apache-2.0)
- Steady commit history through the event
- A README that covers setup, architecture, the trust assumptions and the known leaks

## Trade-off to state

The enclave's own RPC reads and Uniswap's API both see something. Anon-RPC covers the browser only, so list the enclave's reads as a leak instead of hiding it.
