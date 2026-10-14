import { Link, useParams } from "react-router-dom";
import { usePollAudit } from "../lib/usePollAudit";
import { AUDIT_ERROR_TEXT } from "../lib/severity";
import { CategoryScores, OverallScore } from "../components/ScorePanel";
import {
  AiAssessment,
  CriticalIssues,
  ExecutiveSummary,
  RecommendedActions,
  TechnicalFindings,
} from "../components/ReportSections";

export function AuditPage(): JSX.Element {
  const { id = "" } = useParams();
  const view = usePollAudit(id);

  if (view.phase === "loading" || view.phase === "waiting") {
    const label =
      view.phase === "waiting" && view.status.status === "running"
        ? "Analyse läuft …"
        : "Audit wartet in der Warteschlange …";
    return (
      <div
        className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-8 text-center"
        role="status"
      >
        <div
          className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900"
          aria-hidden="true"
        />
        <p className="mt-4 text-sm font-medium text-slate-800">
          {view.phase === "loading" ? "Lade …" : label}
        </p>
        {view.phase === "waiting" && (
          <p className="mt-1 break-all text-xs text-slate-500">{view.status.url}</p>
        )}
      </div>
    );
  }

  if (view.phase === "error") {
    return (
      <div
        className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800"
        role="alert"
      >
        {view.message}{" "}
        <Link to="/" className="underline">
          Zurück
        </Link>
      </div>
    );
  }

  if (view.phase === "failed") {
    const code = view.status.error?.code ?? "INTERNAL_ERROR";
    return (
      <div
        className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-6"
        role="alert"
      >
        <h1 className="text-lg font-semibold text-red-900">Audit fehlgeschlagen</h1>
        <p className="mt-1 break-all text-xs text-red-800">{view.status.url}</p>
        <p className="mt-3 text-sm text-red-900">
          {AUDIT_ERROR_TEXT[code] ?? view.status.error?.message}
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-red-900 underline">
          Neues Audit starten
        </Link>
      </div>
    );
  }

  const { report } = view;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit Report</h1>
        <p className="mt-1 break-all text-sm text-slate-600">{report.audit.url}</p>
        {report.audit.finalUrl && report.audit.finalUrl !== report.audit.url && (
          <p className="break-all text-xs text-slate-500">
            Weitergeleitet nach: {report.audit.finalUrl}
          </p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <OverallScore score={report.score} />
        <ExecutiveSummary ai={report.ai} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <CriticalIssues issues={report.criticalIssues} />
        <CategoryScores score={report.score} />
      </div>
      <RecommendedActions actions={report.recommendedActions} />
      <TechnicalFindings findings={report.technical.findings} />
      <AiAssessment ai={report.ai} />
    </div>
  );
}
