import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export interface ReceiptView {
  id: string;
  verdictCode: string;
  score: number | null;
  handle: string;
  claimedDateIso: string;
  snapshotTs: string;
  originalUrl: string;
  archiveSnippet: string;
  createdAt: number;
}

interface ReceiptCardProps {
  receipt: ReceiptView;
  url: string;
}

export default function ReceiptCard({ receipt, url }: ReceiptCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snippet = receipt.archiveSnippet.slice(0, 140);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, url, { width: 128 }).catch(() => {
      // QR is decorative; link below remains the source of truth.
    });
  }, [url]);

  return (
    <section data-testid="receipt-card" aria-label="Shareable receipt" className="rounded border p-4">
      <h2 className="text-lg font-bold">Receipt {receipt.id}</h2>
      <dl className="mt-2 text-sm">
        <div className="flex gap-2">
          <dt className="font-medium">Verdict:</dt>
          <dd>{receipt.verdictCode}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Score:</dt>
          <dd>{receipt.score == null ? 'n/a' : `${Math.round(receipt.score * 100)}/100`}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Handle:</dt>
          <dd>@{receipt.handle}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">Claimed date:</dt>
          <dd>{receipt.claimedDateIso}</dd>
        </div>
      </dl>
      <p data-testid="receipt-snippet" className="mt-2 text-sm italic">
        “{snippet}”
      </p>
      <canvas data-testid="receipt-qr" ref={canvasRef} width={128} height={128} aria-label={`QR code for ${url}`} />
      <p>
        <a href={url} className="text-sm underline">
          {url}
        </a>
      </p>
      <p className="mt-2 text-xs opacity-70">
        This receipt proves the quoted text existed in the archived capture at the time shown — not that the
        screenshot is untouched. Archive coverage is partial — no archive match does not mean it is not real.
        Most posts are never archived.
      </p>
    </section>
  );
}
