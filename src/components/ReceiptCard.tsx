import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

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
    <Card data-testid="receipt-card" aria-label="Shareable receipt">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Receipt {receipt.id}</CardTitle>
          <Badge variant="secondary">{receipt.verdictCode.replace(/_/g, ' ')}</Badge>
        </div>
        <CardDescription>
          @{receipt.handle} · {receipt.claimedDateIso} · {receipt.score == null ? 'score n/a' : `${Math.round(receipt.score * 100)}/100`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p data-testid="receipt-snippet" className="border-l-2 pl-3 text-sm italic">
          “{snippet}”
        </p>
        <canvas data-testid="receipt-qr" ref={canvasRef} width={128} height={128} aria-label={`QR code for ${url}`} className="rounded-md border" />
        <Button asChild variant="link" className="h-auto p-0 text-sm">
          <a href={url}>
            {url} <ExternalLink />
          </a>
        </Button>
        <p className="text-muted-foreground text-xs">
          This receipt proves the quoted text existed in the archived capture at the time shown — not that the
          screenshot is untouched. Archive coverage is partial — no archive match does not mean it is not real.
          Most posts are never archived.
        </p>
      </CardContent>
    </Card>
  );
}
