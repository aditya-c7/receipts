// Helpful next steps shown after a check (links only - no verdict words here).
export interface NextStep {
  label: string;
  href: string;
  blurb: string;
}

export const NEXT_STEPS: NextStep[] = [
  {
    label: 'Search the Wayback Machine',
    href: 'https://web.archive.org/web/*/https://x.com/*',
    blurb: 'Browse captures for this account directly on web.archive.org.',
  },
  {
    label: 'X advanced search',
    href: 'https://x.com/search-advanced',
    blurb: 'Look for the live post or nearby posts from the same account.',
  },
  {
    label: 'Check the account history',
    href: 'https://x.com/settings/account',
    blurb: 'Renames and deletions break archives - confirm the handle still belongs to the same account.',
  },
  {
    label: 'Support the Internet Archive',
    href: 'https://archive.org/donate',
    blurb: 'The Wayback Machine is a nonprofit. Donations keep captures free.',
  },
];
