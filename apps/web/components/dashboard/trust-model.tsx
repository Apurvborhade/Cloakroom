import { Card, CardBody, CardHeader } from '../ui/card';

const POINTS = [
  ['What it is', 'An enclave keeps a private ledger and executes your signed intents from custody addresses it controls.'],
  ['What it is not', 'Not a ZK mixer, and not anonymity. Deposit and payout amounts and their timing are public on-chain and can be matched.'],
  ['Who you trust', 'The TEE hardware and the operator running it. A single operator holds every custody key; if it disappears, funds are inaccessible.'],
  ['Small anonymity set', 'A handful of custody addresses serve all users. Small sets and distinctive amounts are easy to link.'],
  ['What the operator sees', 'Your IP address and request timing reach the API. Request contents are encrypted to the enclave key.'],
  ['Chain reads', "Browser reads go through Anon-RPC when configured. The enclave's own RPC reads and the Uniswap API are outside it."],
];

export function TrustModel() {
  return (
    <Card>
      <CardHeader title="Trust model" description="Stated plainly, because privacy claims should be checkable." />
      <CardBody>
        <dl className="space-y-3 text-sm">
          {POINTS.map(([title, text]) => (
            <div key={title}>
              <dt className="font-medium text-fg">{title}</dt>
              <dd className="mt-0.5 text-fg-subtle">{text}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
