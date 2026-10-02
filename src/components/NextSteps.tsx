import { NEXT_STEPS } from '../lib/nextSteps';

export default function NextSteps() {
  return (
    <section data-testid="next-steps" aria-label="What to check next" className="rounded border p-3 text-sm">
      <h3 className="font-bold">What to check next</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {NEXT_STEPS.map((s) => (
          <li key={s.href}>
            <a href={s.href} target="_blank" rel="noreferrer" className="underline">
              {s.label}
            </a>{' '}
            <span className="opacity-70">— {s.blurb}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
