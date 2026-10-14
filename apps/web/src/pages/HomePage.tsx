import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AUDIT_CATEGORIES, type AuditCategory } from "@mcopilot/shared-types";
import { api, ApiClientError } from "../lib/api";
import { CATEGORY_LABEL } from "../lib/severity";

/** Ergänzt fehlendes Schema; die eigentliche Validierung (SSRF etc.) erfolgt serverseitig. */
export const normalizeInputUrl = (raw: string): string => {
  const v = raw.trim();
  return v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v;
};

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [modules, setModules] = useState<Set<AuditCategory>>(new Set(AUDIT_CATEGORIES));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (c: AuditCategory): void =>
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!url.trim()) return setError("Bitte eine URL eingeben.");
    if (modules.size === 0) return setError("Bitte mindestens ein Modul auswählen.");
    setSubmitting(true);
    try {
      const { id } = await api.createAudit(
        normalizeInputUrl(url),
        AUDIT_CATEGORIES.filter((c) => modules.has(c)),
      );
      navigate(`/audits/${id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Website Auditor</h1>
      <p className="mt-1 text-sm text-slate-600">
        Analysiert eine öffentliche Website oder Landingpage. Gemessene Befunde und KI-Einschätzung
        werden getrennt ausgewiesen.
      </p>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="mt-6 rounded-lg border border-slate-200 bg-white p-6"
        noValidate
      >
        <label htmlFor="url" className="block text-sm font-medium text-slate-800">
          URL
        </label>
        <input
          id="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.example.com/landingpage"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-slate-800">Audit Modules</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AUDIT_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={modules.has(c)} onChange={() => toggle(c)} />
                {CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Wird gestartet …" : "Analyze Website"}
        </button>
      </form>
    </div>
  );
}
