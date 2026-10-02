import { describe, it, expect } from 'vitest';
import { extractArchivedPost } from '../../../lib/wayback/snapshot';

describe('snapshot extractors', () => {
  it('ldjson wins first', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"SocialMediaPosting","articleBody":"hello ld world, this is a longer tweet for testing","author":{"name":"Alice"}}</script>
      <meta property="og:description" content="og fallback text here, longer fallback for test" />
      <title>Alice on X: "title fallback text here, longer" / X</title>
    </head><body></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.extractor).toBe('ldjson');
    expect(r.text).toContain('hello ld world');
  });

  it('og description with curly quotes stripped', () => {
    const html = `<html><head>
      <meta property="og:description" content="“curly quoted tweet text for og test, longer content”" />
      <meta property="og:title" content='Bob on X: "ignored" / X' />
    </head><body></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.extractor).toBe('og');
    expect(r.text).not.toContain('“');
    expect(r.text).toContain('curly quoted tweet text');
  });

  it('og:title Name on X pattern', () => {
    const html = `<html><head>
      <meta property="og:title" content='Carol on X: "og title tweet body here, with enough length" / X' />
    </head><body></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.extractor).toBe('og');
    expect(r.text).toContain('og title tweet body');
    expect(r.displayName).toBe('Carol');
  });

  it('classic tweet-text', () => {
    const html = `<html><body><div class="permalink-tweet"><p class="tweet-text">classic tweet body text here, sufficiently long <a href="#">link</a></p></div></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.extractor).toBe('classic');
    expect(r.text).toContain('classic tweet body');
    expect(r.text).not.toContain('<a');
  });

  it('embeddedJson full_text', () => {
    const html = `<html><head></head><body><script>window.__X={"full_text":"embedded json tweet body here, long enough for test"}</script></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.extractor).toBe('embeddedJson');
    expect(r.text).toContain('embedded json tweet body');
  });

  it('title fallback', () => {
    const html = `<html><head><title>Dave on X: "title only tweet body, long enough" / X</title></head><body><p>nothing</p></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.extractor).toBe('title');
    expect(r.text).toContain('title only tweet body');
  });

  it('garbage -> none', () => {
    expect(extractArchivedPost('').extractor).toBe('none');
    expect(extractArchivedPost('<html><body>no tweet here</body></html>').text).toBeNull();
  });

  it('oversized does not crash', () => {
    const big = `<html><head><meta property="og:description" content="oversized tweet body, long enough for the test" /></head><body>${'x'.repeat(3_000_000)}</body></html>`;
    const r = extractArchivedPost(big);
    expect(['og', 'none']).toContain(r.extractor);
  });

  it('never returns HTML', () => {
    const html = `<html><body><p class="tweet-text"><b>bold</b> &amp; <i>italic</i> tweet with entities, long enough</p></body></html>`;
    const r = extractArchivedPost(html);
    expect(r.text).not.toContain('<b>');
    expect(r.text).toContain('&');
    expect(r.text).not.toContain('&amp;');
  });
});
