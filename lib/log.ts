// PII-free logger: never log screenshots, OCR text, or raw IPs.
export function log(event: string, fields: Record<string, string | number | boolean> = {}): void {
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/ip|ocr|image|screenshot|text/i.test(k)) continue;
    safe[k] = v;
  }
  console.log(JSON.stringify({ event, ...safe }));
}
