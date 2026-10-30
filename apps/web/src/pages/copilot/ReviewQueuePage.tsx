import { useEffect, useState } from "react";
import type { ClientDto, ReviewDto, ReviewReplyStatus } from "@mcopilot/shared-types";
import { api, ApiClientError } from "../../lib/api";

const STATUS_LABEL: Record<ReviewReplyStatus, string> = {
  none: "Kein Entwurf",
  drafted: "Entwurf bereit",
  posted: "Beantwortet",
  rejected: "Abgelehnt",
};

const STATUS_FILTERS: { value: ReviewReplyStatus | ""; label: string }[] = [
  { value: "drafted", label: "Zur Freigabe" },
  { value: "none", label: "Ohne Entwurf" },
  { value: "posted", label: "Beantwortet" },
  { value: "rejected", label: "Abgelehnt" },
  { value: "", label: "Alle" },
];

function Stars({ rating }: { rating: number }): JSX.Element {
  return (
    <span aria-label={`${rating} von 5 Sternen`} className="text-amber-500">
      {"★".repeat(rating)}
      <span className="text-slate-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function ReviewQueuePage(): JSX.Element {
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState<ReviewReplyStatus | "">("drafted");
  const [reviews, setReviews] = useState<ReviewDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void api.listClients().then((res) => setClients(res.items));
  }, []);

  const reload = async (): Promise<void> => {
    try {
      const res = await api.listReviews({
        ...(clientId ? { clientId } : {}),
        ...(status ? { status } : {}),
      });
      setReviews(res.items);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of res.items) {
          if (!(r.id in next)) next[r.id] = r.reply.editedText ?? r.reply.draftText ?? "";
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    }
  };

  useEffect(() => {
    void reload();
  }, [clientId, status]);

  const clientName = (id: string): string => clients.find((c) => c.id === id)?.name ?? id;

  const onApprove = async (reviewId: string): Promise<void> => {
    setError(null);
    setBusyId(reviewId);
    try {
      const text = drafts[reviewId]?.trim() ?? "";
      const current = reviews?.find((r) => r.id === reviewId);
      if (text && text !== (current?.reply.editedText ?? current?.reply.draftText ?? "")) {
        await api.updateReviewDraft(reviewId, text);
      }
      await api.approveReview(reviewId);
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusyId(null);
    }
  };

  const onSaveDraft = async (reviewId: string): Promise<void> => {
    setError(null);
    setBusyId(reviewId);
    try {
      await api.updateReviewDraft(reviewId, drafts[reviewId]?.trim() ?? "");
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (reviewId: string): Promise<void> => {
    setError(null);
    setBusyId(reviewId);
    try {
      await api.rejectReview(reviewId);
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unbekannter Fehler.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Bewertungen</h1>
      <p className="mt-1 text-sm text-slate-600">
        KI-Entwürfe werden erst nach Freigabe bei Google veröffentlicht. Entwürfe können vor der
        Freigabe bearbeitet werden.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        >
          <option value="">Alle Kunden</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ReviewReplyStatus | "")}
          className="rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {reviews?.length === 0 && <p className="text-sm text-slate-500">Keine Bewertungen.</p>}
        {reviews?.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {r.reviewer.displayName} · <Stars rating={r.starRating} /> ·{" "}
                  {clientName(r.clientId)}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(r.reviewCreatedAt).toLocaleDateString("de-AT")} ·{" "}
                  {STATUS_LABEL[r.reply.status]}
                </p>
              </div>
            </div>
            {r.comment && <p className="mt-2 text-sm text-slate-700">„{r.comment}“</p>}

            {r.reply.status !== "posted" && r.reply.status !== "rejected" && (
              <div className="mt-3">
                <label htmlFor={`reply-${r.id}`} className="sr-only">
                  Antwortentwurf
                </label>
                <textarea
                  id={`reply-${r.id}`}
                  value={drafts[r.id] ?? ""}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  rows={3}
                  placeholder="Antworttext …"
                  className="block w-full rounded border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id || !(drafts[r.id] ?? "").trim()}
                    onClick={() => void onApprove(r.id)}
                    className="inline-flex items-center rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Freigeben &amp; posten
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void onSaveDraft(r.id)}
                    className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Entwurf speichern
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void onReject(r.id)}
                    className="inline-flex items-center rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Ablehnen
                  </button>
                </div>
                {r.reply.error && (
                  <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-800">
                    {r.reply.error.message}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
