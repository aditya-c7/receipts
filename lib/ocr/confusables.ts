// OCR confusable repairs for X handles (Track A). Pure + lowercase output.
//
// OCR commonly misreads: 0<->o, 1<->l, 5<->s, rn<->m. Stripping a leading
// @/©/Q/€ prefix is deliberately NOT done here — lib/ocr/parse.ts already
// handles the prefix when extracting the handle; this module only repairs the
// handle body.

/**
 * Generate up to 6 lookup variants for an OCR-read handle (lowercased):
 *  0. normalized input itself
 *  1. digits -> letters (0->o, 1->l, 5->s)
 *  2. letters -> digits (o->0, l->1, s->5)
 *  3. "rn" -> "m"
 *  4. "m" -> "rn"
 *  5. trailing-char drop (catches merged punctuation, e.g. "nasa," -> "nasa")
 * Duplicates are removed, order is stable, output is always lowercase.
 */
export function repairCandidates(handle: string): string[] {
  const base = handle.toLowerCase().trim();
  if (base === '') return [];
  const out: string[] = [];
  const push = (s: string): void => {
    if (s !== '' && !out.includes(s) && out.length < 6) out.push(s);
  };
  push(base);
  push(base.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's'));
  push(base.replace(/o/g, '0').replace(/l/g, '1').replace(/s/g, '5'));
  push(base.replace(/rn/g, 'm'));
  push(base.replace(/m/g, 'rn'));
  if (base.length > 1) push(base.slice(0, -1));
  return out;
}
