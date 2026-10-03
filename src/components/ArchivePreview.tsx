import { ExternalLink } from 'lucide-react';
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
  return (
    <section data-testid="archive-preview" aria-label="Archived capture preview" className="space-y-2">
      <iframe
        title={`Archived capture of ${originalUrl}`}
        src={preview}
        sandbox=""
        referrerPolicy="no-referrer"
        className="bg-card h-64 w-full rounded-lg border"
      />
      <Button asChild variant="link" className="h-auto p-0 text-sm">
        <a data-testid="archive-open-link" href={archiveUrl} target="_blank" rel="noreferrer">
          Open in Wayback Machine <ExternalLink />
        </a>
      </Button>
    </section>
  );
}
