// Next-step links + reminders for NO_MATCH / partial flows.

export type NextStep = { label: string; url: string } | string;

function nextDay(dateIso: string): string {
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return dateIso;
  return new Date(ms + 86400000).toISOString().slice(0, 10);
}

function cleanHandle(handle: string): string {
  return handle.replace(/^@/, '').trim();
}

/**
 * Build follow-up links: X advanced search (from:/since:/until:), Wayback
 * calendar, site:x.com phrase search, archive.today + Ghost Archive, plus
 * handle-change / deletion reminders as plain strings.
 */
export function buildNextSteps(handle: string, phrase: string, dateIso: string): NextStep[] {
  const h = cleanHandle(handle);
  const until = nextDay(dateIso);
  const short = phrase.trim().split(/\s+/).slice(0, 8).join(' ');
  const steps: NextStep[] = [];

  const adv = `from:${h} since:${dateIso} until:${until}`;
  steps.push({
    label: `Search X for posts by @${h} around ${dateIso}`,
    url: `https://x.com/search?q=${encodeURIComponent(adv)}&src=typed_query`,
  });

  steps.push({
    label: `Open Wayback captures for @${h} posts`,
    url: `https://web.archive.org/web/*/x.com/${h}/status/*`,
  });

  if (short !== '') {
    steps.push({
      label: 'Search the web for the exact phrase (site:x.com)',
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:x.com ${short}`)}`,
    });
  }

  steps.push({
    label: 'Check archive.today for this account',
    url: `https://archive.ph/newest/${encodeURIComponent(`x.com/${h}`)}`,
  });
  steps.push({
    label: 'Check Ghost Archive for this account',
    url: `https://ghostarchive.org/search?term=${encodeURIComponent(`x.com/${h}/status`)}`,
  });

  steps.push(
    'If the account changed its handle, search the old handle — captures stay under the name used at archive time.',
  );
  steps.push(
    'Deleted or protected posts are rarely archived. A missing capture does not confirm anything about the screenshot.',
  );
  return steps;
}
