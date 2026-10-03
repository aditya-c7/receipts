import { useEffect, useRef, useState } from 'react';
import { ReceiptText, TriangleAlert, WifiOff } from 'lucide-react';
import DropZone from './components/DropZone';
import OcrProgress from './components/OcrProgress';
import ScreenshotOverlay from './components/ScreenshotOverlay';
import FieldEditor from './components/FieldEditor';
import VerdictCard from './components/VerdictCard';
import DiffView from './components/DiffView';
import ArchivePreview from './components/ArchivePreview';
import PrivacyDisclosure from './components/PrivacyDisclosure';
import ExamplePicker from './components/ExamplePicker';
import ReceiptCard, { type ReceiptView } from './components/ReceiptCard';
import { Button } from './components/ui/button';
import { Checkbox } from './components/ui/checkbox';
import { Label } from './components/ui/label';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Skeleton } from './components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './components/ui/accordion';
import { Card, CardContent } from './components/ui/card';
import { runCheckFlow, createReceipt, windowFromParsed } from './lib/check-client';
import { runOcr, warmUpOcr } from './lib/ocr-run';
import type { ParsedScreenshot, Verdict } from '../lib/types';

function emptyParsed(): ParsedScreenshot {
  return {
    platform: 'unknown',
    displayName: { value: null, confidence: 0, source: 'ocr' },
    handle: { value: null, confidence: 0, source: 'ocr' },
    text: { value: null, confidence: 0, source: 'ocr' },
    dates: { value: [], confidence: 0, source: 'ocr' },
    language: '',
    ocrMs: 0,
    fieldsEdited: false,
  };
}

function permalinkId(): string | null {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{10})\/?$/);
  return m?.[1] ?? null;
}

/** Dev/QA escape hatch: sample screenshots render only with ?examples=1 (hidden in normal UI). */
function showExamples(): boolean {
  return new URLSearchParams(window.location.search).has('examples');
}

export default function App() {
  const [routeId] = useState<string | null>(() => permalinkId());
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedScreenshot | null>(null);
  const [ocrStage, setOcrStage] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ compared: number; total: number } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [lastSearchPayload, setLastSearchPayload] = useState<unknown>(null);
  const [lastSnapshotPayload, setLastSnapshotPayload] = useState<unknown>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [consentUpload, setConsentUpload] = useState(false);
  const [consentStore, setConsentStore] = useState(false);
  const [receipt, setReceipt] = useState<{ view: ReceiptView; url: string } | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [permalink, setPermalink] = useState<{ view: ReceiptView; url: string } | 'missing' | null>(null);
  const [apiUp, setApiUp] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  // ---- Permalink /r/:id view ----
  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    fetch(`/api/receipt/${routeId}`)
      .then(async (r) => {
        const j = (await r.json()) as { ok: boolean; receipt?: ReceiptView };
        if (!r.ok || !j.receipt) {
          if (!cancelled) setPermalink('missing');
          return;
        }
        if (!cancelled) setPermalink({ view: j.receipt, url: `${window.location.origin}/r/${routeId}` });
      })
      .catch(() => {
        if (!cancelled) setPermalink('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  // ---- API health + OCR warm-up (on mount) ----
  useEffect(() => {
    warmUpOcr();
    let cancelled = false;
    fetch('/api/health')
      .then((r) => {
        if (!cancelled && !r.ok) setApiUp(false);
      })
      .catch(() => {
        if (!cancelled) setApiUp(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- File intake (on-device OCR via src/lib/ocr-run) ----
  function onFile(f: File): void {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(f));
    setVerdict(null);
    setReceipt(null);
    setCheckError(null);
    setOcrStage('read');
    runOcr(f, (_p, stage) => {
      if (stage === 'recognize') setOcrStage('recognize');
    })
      .then((p) => {
        setParsed(p);
        setOcrStage(null);
      })
      .catch(() => {
        setParsed(emptyParsed());
        setCheckError("Couldn't read the screenshot automatically — fill in the fields and we'll re-check.");
        setOcrStage(null);
      });
  }

  // ---- Auto-start check, debounced 500ms, abort in-flight ----
  useEffect(() => {
    if (!parsed || routeId) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setChecking(true);
      setCheckError(null);
      setProgress(null);
      // Clear the previous verdict: it belongs to older field values and
      // must never sit next to freshly-edited fields (stale-verdict trap).
      setVerdict(null);
      setReceipt(null);
      const win = windowFromParsed(parsed);
      setLastSearchPayload({ platform: 'x', handle: parsed.handle.value ?? '', window: win });
      runCheckFlow(parsed, {
        signal: ctrl.signal,
        onStage: (s) => setOcrStage(s),
        onProgress: (compared, total) => setProgress({ compared, total }),
      })
        .then((v) => {
          if (ctrl.signal.aborted) return;
          setVerdict(v);
          setLastSnapshotPayload(
            v.best
              ? { snapshotTs: v.best.candidate.snapshotTs, originalUrl: v.best.candidate.originalUrl }
              : { snapshotTs: '<none — no candidate>', originalUrl: '<none>' },
          );
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setCheckError(e instanceof Error ? e.message : 'Check failed');
        })
        .finally(() => {
          if (!ctrl.signal.aborted) {
            setChecking(false);
            setOcrStage(null);
          }
        });
    }, 500);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [parsed, routeId]);

  async function onCreateReceipt(): Promise<void> {
    if (!parsed || !verdict?.best) return;
    setReceiptError(null);
    setReceiptLoading(true);
    try {
      const dateIso = parsed.dates.value?.[0]?.isoDate ?? '1970-01-01';
      const res = await createReceipt({
        platform: 'x',
        handle: (parsed.handle.value ?? '').trim(),
        claimedDateIso: dateIso,
        claimedText: parsed.text.value ?? '',
        fieldsEdited: parsed.fieldsEdited,
        snapshotTs: verdict.best.candidate.snapshotTs,
        originalUrl: verdict.best.candidate.originalUrl,
      });
      const fullUrl = `${window.location.origin}${res.url}`;
      const view: ReceiptView = {
        id: res.id,
        verdictCode: verdict.code,
        score: verdict.score,
        handle: (parsed.handle.value ?? '').trim(),
        claimedDateIso: dateIso,
        snapshotTs: verdict.best.candidate.snapshotTs,
        originalUrl: verdict.best.candidate.originalUrl,
        archiveSnippet: verdict.best.archived.text ?? '',
        createdAt: Date.now(),
      };
      setReceipt({ view, url: fullUrl });
      setDialogOpen(false);
    } catch (e) {
      setReceiptError(e instanceof Error ? e.message : 'Receipt failed');
    } finally {
      setReceiptLoading(false);
    }
  }

  if (routeId) {
    return (
      <main className="bg-background text-foreground min-h-screen">
        <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <h1 className="text-2xl font-bold">Receipts — shared receipt</h1>
        {permalink === null && <p className="mt-4 text-sm">Loading receipt…</p>}
        {permalink === 'missing' && <p className="mt-4 text-sm">Receipt not found. It may have been removed.</p>}
        {permalink !== null && permalink !== 'missing' && <div className="mt-4"><ReceiptCard receipt={permalink.view} url={permalink.url} /></div>}
        <p className="mt-4 text-sm"><a href="/" className="underline">Check another screenshot</a></p>
        <SiteFooter
          searchPayload={{ platform: 'x', handle: '<handle>', window: { fromMs: 0, toMs: 0 } }}
          snapshotPayload={{ snapshotTs: '<14-digit ts>', originalUrl: 'https://x.com/<handle>/status/<id>' }}
        />
        </div>
      </main>
    );
  }

  const boxes = [
    parsed?.handle.bbox,
    parsed?.text.bbox,
    ...(parsed?.dates.bbox ? [parsed.dates.bbox] : []),
  ].filter(
    (b): b is { x: number; y: number; w: number; h: number } =>
      !!b && b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1 && b.w > 0 && b.w <= 1 && b.h > 0 && b.h <= 1,
  );

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      <header className="flex items-center gap-3">
        <div aria-hidden className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl shadow-xs">
          <ReceiptText className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight">Receipts — Did they really post that?</h1>
          <p className="text-muted-foreground text-sm">
            Drop a screenshot of an X/Twitter post. Reading runs on-device; only the handle + date window leave the device.
          </p>
        </div>
      </header>

      {!apiUp && (
        <Alert variant="destructive">
          <WifiOff />
          <AlertTitle>API not reachable</AlertTitle>
          <AlertDescription>Run pnpm dev:all (starts web + API).</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 pt-4">
      <section aria-label="Upload">
        <DropZone onFile={onFile} disabled={checking} />

        {showExamples() && (
          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold">No screenshot? Try an example</h2>
            <ExamplePicker
              onPick={(p) => {
                setParsed(p);
                setReceipt(null);
              }}
            />
          </div>
        )}
      </section>
        </CardContent>
      </Card>

      {ocrStage && <OcrProgress stage={ocrStage} detail={checking && progress ? `Compared ${progress.compared} of ${progress.total}` : undefined} />}

      {imageUrl && (
        <ScreenshotOverlay imageUrl={imageUrl} boxes={boxes} />
      )}

      {parsed && (
        <FieldEditor parsed={parsed} onChange={setParsed} highlightMissing={verdict?.code === 'INSUFFICIENT_INPUT'} />
      )}

      {checkError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{checkError}</AlertDescription>
        </Alert>
      )}

      {checking && !verdict && parsed && !routeId && (
        <div className="space-y-2" role="status" aria-label="Re-checking archives">
          <Skeleton className="h-24 w-full" />
          <p className="text-muted-foreground text-sm">Re-checking archives…</p>
        </div>
      )}

      {verdict && (
        <section aria-label="Result" className="space-y-3">
          <VerdictCard verdict={verdict} />
          <p data-testid="coverage-line" className="text-sm opacity-70">
            Compared {verdict.coverage.capturesCompared} of {verdict.coverage.capturesFound} archived captures
            {verdict.coverage.truncated ? ' (truncated)' : ''}.
            {verdict.coverage.repairedHandle && (
              <> Handle read as “@{parsed?.handle.value ?? '?'}” had no captures, so we checked the look-alike
              “@{verdict.coverage.repairedHandle}” instead — scored with a mismatch cap.</>
            )}
          </p>
          {verdict.diff && <DiffView diff={verdict.diff} />}
          {verdict.best && <ArchivePreview archiveUrl={verdict.best.candidate.archiveUrl} originalUrl={verdict.best.candidate.originalUrl} />}
        </section>
      )}

      {verdict?.best && !receipt && (
        <Button
          data-testid="create-receipt-open"
          type="button"
          onClick={() => {
            setConsentUpload(false);
            setConsentStore(false);
            setReceiptError(null);
            setDialogOpen(true);
          }}
        >
          Create receipt
        </Button>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="receipt-dialog" aria-label="Create a shareable receipt">
          <DialogHeader>
            <DialogTitle>Create a shareable receipt?</DialogTitle>
            <DialogDescription>
              This uploads the post text you confirmed above so anyone with the link can re-verify it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Label className="cursor-pointer items-start gap-2 font-normal">
              <Checkbox
                data-testid="consent-upload"
                checked={consentUpload}
                onCheckedChange={(v) => setConsentUpload(v === true)}
              />
              <span className="text-sm">I understand my confirmed post text will be uploaded.</span>
            </Label>
            <Label className="cursor-pointer items-start gap-2 font-normal">
              <Checkbox
                data-testid="consent-store"
                checked={consentStore}
                onCheckedChange={(v) => setConsentStore(v === true)}
              />
              <span className="text-sm">I consent to storing this receipt so the link keeps working.</span>
            </Label>
            {receiptError && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>{receiptError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="create-receipt-confirm"
              type="button"
              disabled={!consentUpload || !consentStore || receiptLoading}
              onClick={onCreateReceipt}
            >
              {receiptLoading ? 'Creating…' : 'Create receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {receipt && (
        <>
          <ReceiptCard receipt={receipt.view} url={receipt.url} />
          <Button asChild variant="link" className="h-auto p-0 text-sm">
            <a data-testid="receipt-link" href={new URL(receipt.url).pathname}>Open permalink</a>
          </Button>
        </>
      )}

      <SiteFooter
        searchPayload={lastSearchPayload ?? { platform: 'x', handle: '<handle>', window: { fromMs: 0, toMs: 0 } }}
        snapshotPayload={lastSnapshotPayload ?? { snapshotTs: '<14-digit ts>', originalUrl: 'https://x.com/<handle>/status/<id>' }}
      />
      </div>
    </main>
  );
}

function SiteFooter({ searchPayload, snapshotPayload }: { searchPayload: unknown; snapshotPayload: unknown }) {
  return (
    <footer className="pt-2 text-sm">
      <Accordion type="single" collapsible className="bg-card text-card-foreground rounded-xl border px-4 shadow-xs">
        <AccordionItem value="details">
          <AccordionTrigger>Privacy &amp; details</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <PrivacyDisclosure searchPayload={searchPayload} snapshotPayload={snapshotPayload} />
            <section aria-label="Privacy">
              <h3 className="font-semibold">Privacy — what leaves your device</h3>
              <table className="mt-2 w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">Data</th>
                    <th className="p-2">Leaves device?</th>
                    <th className="p-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b"><td className="p-2">Screenshot pixels</td><td className="p-2">Never</td><td className="p-2">—</td></tr>
                  <tr className="border-b"><td className="p-2">Handle + date window</td><td className="p-2">Yes</td><td className="p-2">Every check (search request)</td></tr>
                  <tr className="border-b"><td className="p-2">Snapshot pointer (ts + URL)</td><td className="p-2">Yes</td><td className="p-2">Every check (snapshot request)</td></tr>
                  <tr className="border-b"><td className="p-2">Post text (OCR)</td><td className="p-2">Only with consent</td><td className="p-2">Create receipt dialog</td></tr>
                  <tr><td className="p-2">IP address</td><td className="p-2">Hashed daily</td><td className="p-2">Rate limiting only; raw IPs never logged</td></tr>
                </tbody>
              </table>
            </section>
            <section aria-label="How it works">
              <h3 className="font-semibold">How it works</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Every post has an ID number that encodes its creation time. We decode that time and keep captures close to
                the claimed date first (time-consistency ranking). Scores are text similarity (0–100) — not a probability,
                and not a ruling on the screenshot. A receipt proves quoted text existed in a specific archived capture, not
                that a screenshot is untouched. Missing archives prove nothing: most posts are never captured.
              </p>
            </section>
            <section aria-label="About and takedown">
              <h3 className="font-semibold">About · takedown</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Contact: adityachitragar2.0@gmail.com. To request removal of a receipt you created, include the receipt link
                (/r/…) and we will remove it.
              </p>
            </section>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <p className="text-muted-foreground mt-3 text-center text-xs">
        Powered by the Internet Archive&apos;s Wayback Machine (not affiliated).{' '}
        <a href="https://archive.org/donate" target="_blank" rel="noreferrer" className="underline">Donate</a>.
      </p>
    </footer>
  );
}
