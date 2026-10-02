import { useRef, useState } from 'react';

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

interface DropZoneProps {
  onFile: (f: File) => void;
  disabled?: boolean;
}

export default function DropZone({ onFile, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function accept(f: File | undefined | null): void {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (name.endsWith('.heic') || name.endsWith('.heif') || f.type === 'image/heic' || f.type === 'image/heif') {
      setError('HEIC photos are not supported — please export or screenshot as PNG/JPEG first.');
      return;
    }
    if (f.type && !ACCEPTED.includes(f.type)) {
      setError(`Unsupported type ${f.type || 'unknown'} — use PNG, JPEG, or WebP.`);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('Image is over the 15 MB cap — please use a smaller screenshot.');
      return;
    }
    setError(null);
    onFile(f);
  }

  return (
    <div
      data-testid="dropzone"
      tabIndex={0}
      aria-label="Drop a screenshot here, paste it, or choose a file"
      className={`rounded-lg border-2 border-dashed p-6 text-center ${dragging ? 'border-black bg-gray-100' : 'border-gray-300'}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        accept(e.dataTransfer.files[0]);
      }}
      onPaste={(e) => {
        if (disabled) return;
        const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
        const f = item?.getAsFile();
        if (f) accept(f);
      }}
    >
      <p className="text-sm font-medium">Drop a screenshot, paste it (Ctrl/⌘+V), or</p>
      <button
        type="button"
        className="mt-2 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Choose file
      </button>
      <input
        data-testid="file-input"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => accept(e.target.files?.[0])}
      />
      <p className="mt-2 text-xs opacity-60">PNG / JPEG / WebP up to 15 MB. OCR runs on-device; images never upload.</p>
      {error && (
        <p data-testid="dropzone-error" role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
