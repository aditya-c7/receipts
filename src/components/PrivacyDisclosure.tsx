interface PrivacyDisclosureProps {
  searchPayload: unknown;
  snapshotPayload: unknown;
  receiptPayload?: unknown;
}

function Block({ title, payload, testid }: { title: string; payload: unknown; testid: string }) {
  return (
    <div>
      <h4 className="mt-2 text-xs font-bold uppercase opacity-60">{title}</h4>
      <pre data-testid={testid} className="mt-1 overflow-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}

export default function PrivacyDisclosure({ searchPayload, snapshotPayload, receiptPayload }: PrivacyDisclosureProps) {
  return (
    <section data-testid="privacy-disclosure" aria-label="Exactly what leaves your device" className="rounded border p-3 text-sm">
      <h3 className="font-bold">Exactly what leaves your device</h3>
      <p className="mt-1 text-xs opacity-70">
        Screenshots and OCR text stay on-device. Only the JSON below is sent — and post text only when you create a receipt.
      </p>
      <Block title="Search request" payload={searchPayload} testid="privacy-search-payload" />
      <Block title="Snapshot request" payload={snapshotPayload} testid="privacy-snapshot-payload" />
      {receiptPayload !== undefined && <Block title="Receipt request (only on opt-in)" payload={receiptPayload} testid="privacy-receipt-payload" />}
    </section>
  );
}
