/** The private routing mark. Decorative, because the text beside it says what it means. */
export function AnonRpcIcon({ size = 14 }: { size?: number }) {
  return (
    // A small local PNG, which next/image would not improve.
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/anon-rpc-shield.png" alt="" aria-hidden width={Math.round((size * 46) / 58)} height={size} className="shrink-0" />
  );
}
