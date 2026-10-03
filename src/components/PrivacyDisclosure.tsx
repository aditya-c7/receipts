interface PrivacyDisclosureProps {
  searchPayload: unknown;
  snapshotPayload: unknown;
  receiptPayload?: unknown;
}

function Block({ title, payload, testid }: { title: string; payload: unknown; testid: string }) {
  return (
    <div>
      <h4 className="text-muted-foreground mt-3 text-xs font-semibold tracking-wide uppercase">{title}</h4>
      <pre data-testid={testid} className="bg-muted mt-1 overflow-auto rounded-md p-3 font-mono text-xs">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

export default function PrivacyDisclosure({ searchPayload, snapshotPayload, receiptPayload }: PrivacyDisclosureProps) {
  return (
    <section data-testid="privacy-disclosure" aria-label="Exactly what leaves your device" className="text-sm">
      <h3 className="font-semibold">Exactly what leaves your device</h3>
      <p className="text-muted-foreground mt-1 text-xs">
        Screenshots and OCR text stay on-device. Only the JSON below is sent - and post text only when you create a receipt.
      </p>
      <Block title="Search request" payload={searchPayload} testid="privacy-search-payload" />
      <Block title="Snapshot request" payload={snapshotPayload} testid="privacy-snapshot-payload" />
      {receiptPayload !== undefined && <Block title="Receipt request (only on opt-in)" payload={receiptPayload} testid="privacy-receipt-payload" />}
    </section>
  );
}
