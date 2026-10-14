import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AuditSummaryDto } from "@mcopilot/shared-types";
import { api } from "../lib/api";
import { ScoreValue } from "../components/ScorePanel";

const STATUS_LABEL: Record<AuditSummaryDto["status"], string> = {
  queued: "Wartet",
  running: "Läuft",
  completed: "Abgeschlossen",
  failed: "Fehlgeschlagen",
};

export function HistoryPage(): JSX.Element {
  const [items, setItems] = useState<AuditSummaryDto[]>([]);
  const [token, setToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (continuation?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.listAudits(20, continuation);
      setItems((prev) => (continuation ? [...prev, ...page.items] : page.items));
      setToken(page.continuationToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm("Audit endgültig löschen?")) return;
    try {
      await api.deleteAudit(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen.");
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Verlauf</h1>
      <p className="mt-1 text-sm text-slate-600">
        Ihre bisherigen Audits (werden nach 90 Tagen automatisch gelöscht).
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <ul className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <Link
                to={`/audits/${a.id}`}
                className="block truncate text-sm font-medium text-slate-900 hover:underline"
              >
                {a.url}
              </Link>
              <p className="text-xs text-slate-500">
                {new Date(a.createdAt).toLocaleString("de-DE")} · {STATUS_LABEL[a.status]}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-lg font-semibold tabular-nums">
                <ScoreValue score={a.overallScore} />
              </span>
              <button
                type="button"
                onClick={() => void remove(a.id)}
                className="text-xs text-slate-500 hover:text-red-700"
                aria-label={`Audit ${a.url} löschen`}
              >
                Löschen
              </button>
            </div>
          </li>
        ))}
        {!loading && items.length === 0 && (
          <li className="px-4 py-6 text-sm text-slate-500">Noch keine Audits.</li>
        )}
      </ul>
      {loading && <p className="mt-4 text-sm text-slate-500">Lade …</p>}
      {token && !loading && (
        <button
          type="button"
          onClick={() => void load(token)}
          className="mt-4 text-sm text-slate-700 underline"
        >
          Mehr laden
        </button>
      )}
    </div>
  );
}
