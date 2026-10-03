import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';

interface ArchivePreviewProps {
  archiveUrl: string;
  originalUrl: string;
}

function toFramed(url: string): string {
  return url.includes('id_/') ? url.replace('id_/', 'if_/') : url;
}

export default function ArchivePreview({ archiveUrl, originalUrl }: ArchivePreviewProps) {
  const preview = toFramed(archiveUrl);
  const [copied, setCopied] = useState(false);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(originalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions); the link itself still works.
      setCopied(false);
    }
  }

  return (
    <section data-testid="archive-preview" aria-label="Archived capture preview" className="space-y-2">
      <iframe
        title={`Archived capture of ${originalUrl}`}
        src={preview}
        sandbox=""
        referrerPolicy="no-referrer"
        className="bg-card h-64 w-full rounded-lg border"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="link" className="h-auto p-0 text-sm">
          <a data-testid="archive-open-link" href={archiveUrl} target="_blank" rel="noreferrer">
            Open in Wayback Machine <ExternalLink />
          </a>
        </Button>
        <span aria-hidden className="text-muted-foreground text-sm">·</span>
        <Button asChild variant="link" className="h-auto p-0 text-sm">
          <a data-testid="original-open-link" href={originalUrl} target="_blank" rel="noreferrer">
            View original on X <ExternalLink />
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="original-copy"
          onClick={copyLink}
          aria-live="polite"
        >
          {copied ? (
            <>Copied <Check /></>
          ) : (
            <>Copy link <Copy /></>
          )}
        </Button>
      </div>
    </section>
  );
}
