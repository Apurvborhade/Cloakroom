# Prize integrations

Three prizes, each wired into the real flow so none is a bolt-on. Requirements are from the [ETHGlobal Mumbai prizes page](https://ethglobal.com/events/mumbai/prizes).

| Prize | What to build | Evidence to ship | Watch out | Lead |
| --- | --- | --- | --- | --- |
| Uniswap Foundation, Build with Uniswap ($10,000 pool) | Swap execution through the Uniswap API and router from custody EOAs | Public open-source repo, `FEEDBACK.md`, completed [Uniswap feedback form](https://developers.uniswap.org/hackathon-feedback) with the file link, README pointing to the integration code lines | Submissions without the feedback file are audited before winners are set | Apurva builds, Pradnyesh submits |
| Ethereum Foundation, Anon-RPC ($5,000), with CROPS ($3,500) as backup | Frontend sends its chain reads through Anon-RPC by default | Demo showing reads going through it, plus a list of any traffic left out and why | Judges score how much traffic uses it. EF places a project in at most one EF prize. CROPS needs a README section titled CROPS plus an open-source licence | Pradnyesh |
| Chainlink, Best workflow with CRE ($1,500) | A CRE workflow reads an external price API and an on-chain source, then posts a signed price report to `/oracle/price` | Successful CRE CLI simulation shown in the demo (deployment is optional) | It must be meaningfully used. The enclave still cross-checks the price and enforces a minimum output, so a bad report cannot drain funds | Pradnyesh |

## Repo hygiene for all three

- Public repo from the first commit
- A licence file (MIT or Apache-2.0)
- Steady commit history through the event
- A README that covers setup, architecture, the trust assumptions and the known leaks

## Trade-off to state

The enclave's own RPC reads and the CRE workflow both see something. Anon-RPC covers the browser only, so list the enclave's reads as a leak instead of hiding it.
