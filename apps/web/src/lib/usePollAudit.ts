import { useEffect, useState } from "react";
import type { AuditReportDto, AuditStatusDto } from "@mcopilot/shared-types";
import { api, ApiClientError } from "./api";

export type AuditView =
  | { phase: "loading" }
  | { phase: "waiting"; status: AuditStatusDto }
  | { phase: "failed"; status: AuditStatusDto }
  | { phase: "done"; report: AuditReportDto }
  | { phase: "error"; message: string };

const FIRST_DELAY_MS = 2000;
const MAX_DELAY_MS = 10_000;

/** Pollt den Audit-Status (Backoff 2 s → 10 s) und lädt danach den Report. */
export function usePollAudit(
  id: string,
  delays = { first: FIRST_DELAY_MS, max: MAX_DELAY_MS },
): AuditView {
  const [view, setView] = useState<AuditView>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setView({ phase: "loading" });

    const tick = async (delay: number): Promise<void> => {
      try {
        const status = await api.getAudit(id);
        if (cancelled) return;
        if (status.status === "completed") {
          const report = await api.getReport(id);
          if (!cancelled) setView({ phase: "done", report });
          return;
        }
        if (status.status === "failed") {
          setView({ phase: "failed", status });
          return;
        }
        setView({ phase: "waiting", status });
        timer = setTimeout(() => void tick(Math.min(delay * 1.5, delays.max)), delay);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError && err.status === 404
            ? "Audit nicht gefunden."
            : err instanceof Error
              ? err.message
              : "Unbekannter Fehler.";
        setView({ phase: "error", message });
      }
    };

    void tick(delays.first);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  return view;
}
