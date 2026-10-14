import type { TechnicalFinding } from "@mcopilot/shared-types";
import { findingTone, TONE_CLASSES, TONE_LABEL } from "../lib/severity";

export function ToneBadge({ tone }: { tone: keyof typeof TONE_CLASSES }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone].badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_CLASSES[tone].dot}`} aria-hidden="true" />
      {TONE_LABEL[tone]}
    </span>
  );
}

const formatEvidence = (v: unknown): string =>
  Array.isArray(v) ? v.join(", ") || "–" : v === null ? "–" : String(v);

export function FindingRow({ finding }: { finding: TechnicalFinding }): JSX.Element {
  const tone = findingTone(finding);
  const evidence = Object.entries(finding.evidence);
  return (
    <li className="py-3" data-testid={`finding-${finding.ruleId}`} data-tone={tone}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-900">{finding.message}</p>
        <ToneBadge tone={tone} />
      </div>
      <p className="mt-0.5 font-mono text-xs text-slate-400">{finding.ruleId}</p>
      {evidence.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-500">Messwerte</summary>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs text-slate-600">
            {evidence.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-slate-500">{k}</dt>
                <dd className="break-words">{formatEvidence(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}
