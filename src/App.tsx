import { useEffect, useRef, useState } from 'react';
import DropZone from './components/DropZone';
import OcrProgress from './components/OcrProgress';
import ScreenshotOverlay from './components/ScreenshotOverlay';
import FieldEditor from './components/FieldEditor';
import VerdictCard from './components/VerdictCard';
import DiffView from './components/DiffView';
import ArchivePreview from './components/ArchivePreview';
import NextSteps from './components/NextSteps';
import PrivacyDisclosure from './components/PrivacyDisclosure';
import ExamplePicker from './components/ExamplePicker';
import ReceiptCard, { type ReceiptView } from './components/ReceiptCard';
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
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-bold">Receipts — shared receipt</h1>
        {permalink === null && <p className="mt-4 text-sm">Loading receipt…</p>}
        {permalink === 'missing' && <p className="mt-4 text-sm">Receipt not found. It may have been removed.</p>}
        {permalink !== null && permalink !== 'missing' && <div className="mt-4"><ReceiptCard receipt={permalink.view} url={permalink.url} /></div>}
        <p className="mt-4 text-sm"><a href="/" className="underline">Check another screenshot</a></p>
        <Footers />
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
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">Receipts — Did they really post that?</h1>
      <p className="text-sm opacity-80">
        Drop a screenshot of an X/Twitter post. Reading runs on-device; only the handle + date window leave the device.
      </p>

      {!apiUp && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          API not reachable. Run pnpm dev:all (starts web + API).
        </p>
      )}

      <DropZone onFile={onFile} disabled={checking} />

      <div>
        <h2 className="mb-2 text-sm font-bold">No screenshot? Try an example</h2>
        <ExamplePicker
          onPick={(p) => {
            setParsed(p);
            setReceipt(null);
          }}
        />
      </div>

      {ocrStage && <OcrProgress stage={ocrStage} detail={checking && progress ? `Compared ${progress.compared} of ${progress.total}` : undefined} />}

      {imageUrl && (
        <ScreenshotOverlay imageUrl={imageUrl} boxes={boxes} />
      )}

      {parsed && (
        <FieldEditor parsed={parsed} onChange={setParsed} highlightMissing={verdict?.code === 'INSUFFICIENT_INPUT'} />
      )}

      {checkError && <p role="alert" className="text-sm text-red-700">{checkError}</p>}

      {checking && !verdict && parsed && !routeId && (
        <p role="status" className="text-sm opacity-70">Re-checking archives…</p>
      )}

      {verdict && (
        <>
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
          <NextSteps />
        </>
      )}

      {verdict?.best && !receipt && (
        <button
          data-testid="create-receipt-open"
          type="button"
          className="rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
          onClick={() => {
            setConsentUpload(false);
            setConsentStore(false);
            setReceiptError(null);
            setDialogOpen(true);
          }}
        >
          Create receipt
        </button>
      )}

      {dialogOpen && (
        <div data-testid="receipt-dialog" role="dialog" aria-label="Create a shareable receipt" className="rounded border p-4">
          <h3 className="font-bold">Create a shareable receipt?</h3>
          <p className="mt-1 text-sm opacity-70">
            This uploads the post text you confirmed above so anyone with the link can re-verify it.
          </p>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input data-testid="consent-upload" type="checkbox" checked={consentUpload} onChange={(e) => setConsentUpload(e.target.checked)} />
            I understand my confirmed post text will be uploaded.
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input data-testid="consent-store" type="checkbox" checked={consentStore} onChange={(e) => setConsentStore(e.target.checked)} />
            I consent to storing this receipt so the link keeps working.
          </label>
          {receiptError && <p role="alert" className="mt-2 text-sm text-red-700">{receiptError}</p>}
          <div className="mt-3 flex gap-2">
            <button
              data-testid="create-receipt-confirm"
              type="button"
              disabled={!consentUpload || !consentStore || receiptLoading}
              className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
              onClick={onCreateReceipt}
            >
              {receiptLoading ? 'Creating…' : 'Create receipt'}
            </button>
            <button type="button" className="rounded border px-4 py-2 text-sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {receipt && (
        <>
          <ReceiptCard receipt={receipt.view} url={receipt.url} />
          <p className="text-sm"><a data-testid="receipt-link" href={new URL(receipt.url).pathname} className="underline">Open permalink</a></p>
        </>
      )}

      <PrivacyDisclosure
        searchPayload={lastSearchPayload ?? { platform: 'x', handle: '<handle>', window: { fromMs: 0, toMs: 0 } }}
        snapshotPayload={lastSnapshotPayload ?? { snapshotTs: '<14-digit ts>', originalUrl: 'https://x.com/<handle>/status/<id>' }}
      />

      <Footers />
    </main>
  );
}

function Footers() {
  return (
    <footer className="space-y-6 pt-6 text-sm">
      <section aria-label="Privacy">
        <h3 className="font-bold">Privacy — what leaves your device</h3>
        <table className="mt-2 w-full border text-left text-xs">
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
        <h3 className="font-bold">How it works</h3>
        <p className="mt-1 text-xs opacity-80">
          Every post has an ID number that encodes its creation time. We decode that time and keep captures close to
          the claimed date first (time-consistency ranking). Scores are text similarity (0–100) — not a probability,
          and not a ruling on the screenshot. A receipt proves quoted text existed in a specific archived capture, not
          that a screenshot is untouched. Missing archives prove nothing: most posts are never captured.
        </p>
      </section>
      <section aria-label="About and takedown">
        <h3 className="font-bold">About · takedown</h3>
        <p className="mt-1 text-xs opacity-80">
          Contact: adityachitragar2.0@gmail.com. To request removal of a receipt you created, include the receipt link
          (/r/…) and we will remove it.
        </p>
      </section>
      <p className="text-xs opacity-60">
        Powered by the Internet Archive&apos;s Wayback Machine (not affiliated).{' '}
        <a href="https://archive.org/donate" target="_blank" rel="noreferrer" className="underline">Donate to the Internet Archive</a>.
      </p>
    </footer>
  );
}
