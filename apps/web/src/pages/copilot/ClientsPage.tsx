import { FormEvent, useEffect, useState } from "react";
import type { ClientCategory, ClientDto } from "@mcopilot/shared-types";
import { api, ApiClientError } from "../../lib/api";

const CATEGORY_LABEL: Record<ClientCategory, string> = {
  handel: "Kleiner lokaler Handel",
  kmu: "KMU",
  other: "Sonstige",
};

export function ClientsPage(): JSX.Element {
  const [clients, setClients] = useState<ClientDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClientCategory>("handel");
  const [creating, setCreating] = useState(false);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ clientId: string; summary: string } | null>(null);

  const reload = async (): Promise<void> => {
    try {
      const res = await api.listClients();
      setClients(res.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Bitte einen Namen eingeben.");
    setCreating(true);
    try {
      await api.createClient(name.trim(), category);
      setName("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    } finally {
      setCreating(false);
    }
  };

  const onConnectGoogle = async (clientId: string): Promise<void> => {
    setError(null);
    setBusyClientId(clientId);
    try {
      const { authorizeUrl } = await api.googleAuthorize(clientId);
      window.location.assign(authorizeUrl);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
      setBusyClientId(null);
    }
  };

  const onSelectLocation = async (clientId: string, locationName: string): Promise<void> => {
    setError(null);
    setBusyClientId(clientId);
    try {
      await api.selectGoogleLocation(clientId, locationName);
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusyClientId(null);
    }
  };

  const onSync = async (clientId: string): Promise<void> => {
    setError(null);
    setBusyClientId(clientId);
    setSyncResult(null);
    try {
      const res = await api.syncReviews(clientId);
      setSyncResult({
        clientId,
        summary: `${res.newReviews} neue Bewertung(en), ${res.draftedReplies} Entwurf/Entwürfe erstellt${
          res.failedDrafts > 0 ? `, ${res.failedDrafts} fehlgeschlagen` : ""
        }.`,
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusyClientId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Kunden</h1>
      <p className="mt-1 text-sm text-slate-600">
        Jeder Kunde kann ein Google-Business-Profil verbinden. KI-Antwortentwürfe auf neue
        Bewertungen müssen vor dem Posten freigegeben werden.
      </p>

      <form
        onSubmit={(e) => void onCreate(e)}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        noValidate
      >
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="client-name" className="block text-sm font-medium text-slate-800">
            Name
          </label>
          <input
            id="client-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>
        <div>
          <label htmlFor="client-category" className="block text-sm font-medium text-slate-800">
            Kategorie
          </label>
          <select
            id="client-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ClientCategory)}
            className="mt-1 block rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {(Object.keys(CATEGORY_LABEL) as ClientCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Wird angelegt …" : "Kunde anlegen"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="mt-6 space-y-3">
        {clients?.length === 0 && <p className="text-sm text-slate-500">Noch keine Kunden.</p>}
        {clients?.map((c) => (
          <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">{CATEGORY_LABEL[c.category]}</p>
              </div>

              {c.googleAccount ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-600">
                    Verbunden: {c.googleAccount.displayName}
                    {c.googleAccount.lastSyncAt && (
                      <>
                        {" "}
                        · zuletzt synchronisiert{" "}
                        {new Date(c.googleAccount.lastSyncAt).toLocaleString("de-AT")}
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busyClientId === c.id}
                    onClick={() => void onSync(c.id)}
                    className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busyClientId === c.id ? "Synchronisiert …" : "Neue Bewertungen abrufen"}
                  </button>
                </div>
              ) : c.pendingGoogleLocations ? (
                <div className="w-full">
                  <p className="text-xs text-slate-600">Standort wählen:</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {c.pendingGoogleLocations.map((loc) => (
                      <button
                        key={loc.locationName}
                        type="button"
                        disabled={busyClientId === c.id}
                        onClick={() => void onSelectLocation(c.id, loc.locationName)}
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loc.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busyClientId === c.id}
                  onClick={() => void onConnectGoogle(c.id)}
                  className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Mit Google verbinden
                </button>
              )}
            </div>
            {syncResult?.clientId === c.id && (
              <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {syncResult.summary}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
