import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Renders a QR code as a data-URL image.
 *
 * Generation happens on the device with no network call, so labels can be
 * printed from the warehouse laptop whether or not the internet is up.
 */
export function QrCode({
  value,
  size = 160,
  alt = 'QR code',
}: {
  value: string;
  size?: number;
  alt?: string;
}) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size * 2, // 2× so it stays crisp when printed
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) return <div style={{ width: size, height: size, background: '#eee' }} aria-hidden />;
  return <img src={src} width={size} height={size} alt={alt} />;
}
