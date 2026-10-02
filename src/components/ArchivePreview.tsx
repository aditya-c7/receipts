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
    <section data-testid="archive-preview" aria-label="Archived capture preview" className="rounded border p-3">
      <iframe
        title={`Archived capture of ${originalUrl}`}
        src={preview}
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-64 w-full rounded bg-white"
      />
      <a
        data-testid="archive-open-link"
        href={archiveUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-sm underline"
      >
        Open in Wayback Machine
      </a>
    </section>
  );
}
