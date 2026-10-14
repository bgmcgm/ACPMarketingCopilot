import type { AuditScore } from "@mcopilot/shared-types";
import {
  CATEGORY_LABEL,
  CATEGORY_NOTE,
  CATEGORY_ORDER,
  SCORE_CLASSES,
  scoreBand,
} from "../lib/severity";

export function ScoreValue({ score }: { score: number | null }): JSX.Element {
  if (score === null) return <span className="text-slate-400">n/a</span>;
  return <span className={SCORE_CLASSES[scoreBand(score)].text}>{score}</span>;
}

export function OverallScore({ score }: { score: AuditScore | null }): JSX.Element {
  return (
    <section
      aria-labelledby="overall-heading"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2
        id="overall-heading"
        className="text-sm font-medium uppercase tracking-wide text-slate-500"
      >
        Overall Score
      </h2>
      <p className="mt-2 text-5xl font-semibold tabular-nums" data-testid="overall-score">
        <ScoreValue score={score?.overall ?? null} />
        <span className="ml-1 text-lg font-normal text-slate-400">/ 100</span>
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Deterministisch aus den gemessenen Befunden berechnet – unabhängig von der KI-Bewertung.
      </p>
    </section>
  );
}

export function CategoryScores({ score }: { score: AuditScore | null }): JSX.Element | null {
  if (!score) return null;
  const rows = CATEGORY_ORDER.filter((c) => c in score.categories);
  return (
    <section
      aria-labelledby="categories-heading"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2
        id="categories-heading"
        className="text-sm font-medium uppercase tracking-wide text-slate-500"
      >
        Category Scores
      </h2>
      <ul className="mt-4 space-y-3">
        {rows.map((c) => {
          const value = score.categories[c] ?? null;
          return (
            <li key={c}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium text-slate-800">
                  {CATEGORY_LABEL[c]}
                  {CATEGORY_NOTE[c] && (
                    <span className="ml-2 text-xs font-normal text-slate-500">(Indikatoren)</span>
                  )}
                </span>
                <span className="tabular-nums font-semibold">
                  <ScoreValue score={value} />
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100" role="presentation">
                {value !== null && (
                  <div
                    className={`h-2 rounded-full ${SCORE_CLASSES[scoreBand(value)].bar}`}
                    style={{ width: `${value}%` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
