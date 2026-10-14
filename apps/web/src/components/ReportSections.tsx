import { useState } from "react";
import type { AuditReportDto, TechnicalFinding } from "@mcopilot/shared-types";
import { FindingRow } from "./FindingRow";
import {
  AI_SEVERITY_LABEL,
  CATEGORY_LABEL,
  CATEGORY_NOTE,
  CATEGORY_ORDER,
  compareFindings,
  findingTone,
  OWNER_LABEL,
} from "../lib/severity";

export function CriticalIssues({ issues }: { issues: TechnicalFinding[] }): JSX.Element {
  return (
    <section
      aria-labelledby="critical-heading"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2
        id="critical-heading"
        className="text-sm font-medium uppercase tracking-wide text-slate-500"
      >
        Critical Issues
      </h2>
      {issues.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-700">
          Keine kritischen technischen Befunde gemessen.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {issues.map((f) => (
            <FindingRow key={f.ruleId} finding={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Gemessene Befunde – visuell klar von der KI-Bewertung getrennt (blauer Rand "Gemessen"). */
export function TechnicalFindings({ findings }: { findings: TechnicalFinding[] }): JSX.Element {
  const [issuesOnly, setIssuesOnly] = useState(false);
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: findings
      .filter((f) => f.category === category)
      .filter((f) => !issuesOnly || ["critical", "warning"].includes(findingTone(f)))
      .sort(compareFindings),
  })).filter((g) => g.items.length > 0);

  return (
    <section
      aria-labelledby="technical-heading"
      className="rounded-lg border border-slate-200 border-l-4 border-l-sky-600 bg-white p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="technical-heading" className="text-lg font-semibold text-slate-900">
            Measured Technical Findings
          </h2>
          <p className="text-xs text-slate-500">
            Deterministisch von der Rules Engine gemessen. Reproduzierbar, nicht KI-generiert.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={issuesOnly}
            onChange={(e) => setIssuesOnly(e.target.checked)}
          />
          Nur Probleme
        </label>
      </div>
      {groups.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Keine Befunde in dieser Ansicht.</p>
      )}
      {groups.map((g) => (
        <div key={g.category} className="mt-5">
          <h3 className="text-sm font-semibold text-slate-800">
            {CATEGORY_LABEL[g.category]}
            {CATEGORY_NOTE[g.category] && (
              <span className="ml-2 text-xs font-normal text-slate-500">
                {CATEGORY_NOTE[g.category]}
              </span>
            )}
          </h3>
          <ul className="mt-1 divide-y divide-slate-100">
            {g.items.map((f) => (
              <FindingRow key={f.ruleId} finding={f} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function ExecutiveSummary({ ai }: { ai: AuditReportDto["ai"] }): JSX.Element {
  return (
    <section
      aria-labelledby="summary-heading"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2
        id="summary-heading"
        className="text-sm font-medium uppercase tracking-wide text-slate-500"
      >
        Executive Summary
      </h2>
      {ai?.status === "completed" && ai.result ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-slate-800">
            {ai.result.executiveSummary}
          </p>
          <p className="mt-2 text-xs text-violet-700">KI-generierte Interpretation</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Keine KI-Zusammenfassung verfügbar.</p>
      )}
    </section>
  );
}

export function RecommendedActions({
  actions,
}: {
  actions: AuditReportDto["recommendedActions"];
}): JSX.Element {
  return (
    <section
      aria-labelledby="actions-heading"
      className="rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2
        id="actions-heading"
        className="text-sm font-medium uppercase tracking-wide text-slate-500"
      >
        Recommended Actions
      </h2>
      {actions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Keine Empfehlungen verfügbar.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {[...actions]
            .sort((a, b) => a.priority - b.priority)
            .map((a) => (
              <li key={`${a.priority}-${a.action}`} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {a.priority}
                </span>
                <span className="text-slate-800">
                  {a.action}
                  <span className="ml-2 text-xs text-slate-500">
                    ({OWNER_LABEL[a.ownerType] ?? a.ownerType})
                  </span>
                </span>
              </li>
            ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-violet-700">KI-generierte Empfehlungen</p>
    </section>
  );
}

/** KI-Bewertung – bewusst anders gestaltet (violetter Rand, Hinweisband) als die gemessenen Befunde. */
export function AiAssessment({ ai }: { ai: AuditReportDto["ai"] }): JSX.Element {
  return (
    <section
      aria-labelledby="ai-heading"
      className="rounded-lg border border-violet-200 border-l-4 border-l-violet-600 bg-violet-50/40 p-6"
    >
      <h2 id="ai-heading" className="text-lg font-semibold text-slate-900">
        AI Marketing Assessment
      </h2>
      <p className="mt-1 rounded bg-violet-100 px-2 py-1 text-xs text-violet-900">
        KI-generierte Interpretation auf Basis des Seitentexts. Kein Messwert und ohne Einfluss auf
        den Score. Bitte fachlich prüfen.
      </p>

      {!ai || ai.status === "skipped" ? (
        <p className="mt-4 text-sm text-slate-600">
          Die KI-Bewertung ist für dieses Audit deaktiviert.
        </p>
      ) : ai.status === "failed" || !ai.result ? (
        <p className="mt-4 text-sm text-slate-700" role="status">
          Die KI-Bewertung ist nicht verfügbar{ai.error ? `: ${ai.error.message}` : "."} Die
          gemessenen technischen Befunde sind davon nicht betroffen.
        </p>
      ) : (
        <>
          {ai.result.marketingFindings.length === 0 && (
            <p className="mt-4 text-sm text-slate-600">Keine Auffälligkeiten festgestellt.</p>
          )}
          <ul className="mt-4 space-y-4">
            {ai.result.marketingFindings.map((f, i) => (
              <li
                key={i}
                className="rounded border border-violet-100 bg-white p-4"
                data-testid="ai-finding"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-800">
                    {f.category === "messaging" ? "Messaging" : CATEGORY_LABEL[f.category]}
                  </span>
                  <span>Relevanz: {AI_SEVERITY_LABEL[f.severity]}</span>
                  <span>Konfidenz: {AI_SEVERITY_LABEL[f.confidence]}</span>
                </div>
                <p className="mt-2 text-sm text-slate-900">{f.finding}</p>
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-medium">Empfehlung: </span>
                  {f.recommendation}
                </p>
              </li>
            ))}
          </ul>
          {ai.result.limitations.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-800">Einschränkungen</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                {ai.result.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
