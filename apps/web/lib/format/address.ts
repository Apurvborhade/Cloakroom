export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function explorerTxUrl(explorer: string | null, hash: string): string | null {
  return explorer ? `${explorer.replace(/\/+$/, '')}/tx/${hash}` : null;
}

export function explorerAddressUrl(explorer: string | null, address: string): string | null {
  return explorer ? `${explorer.replace(/\/+$/, '')}/address/${address}` : null;
}
