'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A real QR code generated locally (no network), encoding an EIP-681 payment URI. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a0a0b', light: '#ededf0' } })
      .then((text) => !cancelled && setSvg(text))
      .catch(() => !cancelled && setSvg(null));
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!svg) return <div className="h-40 w-40 rounded-lg bg-ink-800" aria-hidden />;
  return <div role="img" aria-label={label} className="h-40 w-40 overflow-hidden rounded-lg" dangerouslySetInnerHTML={{ __html: svg }} />;
}
