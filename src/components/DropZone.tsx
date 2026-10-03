import { useRef, useState } from 'react';
import { ImagePlus, TriangleAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';

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
      setError('HEIC photos are not supported - please export or screenshot as PNG/JPEG first.');
      return;
    }
    if (f.type && !ACCEPTED.includes(f.type)) {
      setError(`Unsupported type ${f.type || 'unknown'} - use PNG, JPEG, or WebP.`);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('Image is over the 15 MB cap - please use a smaller screenshot.');
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
      className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-primary bg-accent' : 'border-border'}`}
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
      <ImagePlus aria-hidden className="text-muted-foreground mx-auto size-8" />
      <p className="mt-2 text-sm font-medium">Drop a screenshot, paste it (Ctrl/⌘+V), or</p>
      <Button type="button" className="mt-3" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose file
      </Button>
      <input
        data-testid="file-input"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => accept(e.target.files?.[0])}
      />
      <p className="text-muted-foreground mt-3 text-xs">PNG / JPEG / WebP up to 15 MB. OCR runs on-device; images never upload.</p>
      {error && (
        <Alert variant="destructive" data-testid="dropzone-error" className="mt-3 text-left">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
