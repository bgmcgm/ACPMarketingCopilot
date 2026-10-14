// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "../../apps/web/src/pages/AuditPage";
import { jsonResponse, report, status } from "./fixtures";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/audits/a1"]}>
      <Routes>
        <Route path="/audits/:id" element={<AuditPage />} />
      </Routes>
    </MemoryRouter>,
  );

const respondWith = (statusBody: unknown, reportBody?: unknown): void => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/report")) return jsonResponse(200, reportBody);
    return jsonResponse(200, statusBody);
  });
};

describe("AuditPage – report", () => {
  it("renders all required sections in the specified order", async () => {
    respondWith(status({ status: "completed" }), report());
    renderPage();
    await screen.findByText("Audit Report");
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    const order = [
      "Overall Score",
      "Executive Summary",
      "Critical Issues",
      "Category Scores",
      "Recommended Actions",
      "Measured Technical Findings",
      "AI Marketing Assessment",
    ];
    const positions = order.map((o) => headings.indexOf(o));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((x, y) => x - y)); // Reihenfolge laut Spezifikation
  });

  it("shows the deterministic scores", async () => {
    respondWith(status({ status: "completed" }), report());
    renderPage();
    expect((await screen.findByTestId("overall-score")).textContent).toContain("72");
    const cat = screen.getByRole("heading", { name: "Category Scores" }).closest("section")!;
    expect(within(cat).getByText("SEO")).toBeTruthy();
    expect(within(cat).getByText("Conversion")).toBeTruthy();
    expect(within(cat).getByText("n/a")).toBeTruthy(); // conversion = null
    expect(within(cat).getByText("(Indikatoren)")).toBeTruthy(); // Consent
  });

  it("keeps measured findings and AI content in separate, labelled sections", async () => {
    respondWith(status({ status: "completed" }), report());
    renderPage();
    await screen.findByText("Audit Report");
    const tech = screen
      .getByRole("heading", { name: "Measured Technical Findings" })
      .closest("section")!;
    const ai = screen.getByRole("heading", { name: "AI Marketing Assessment" }).closest("section")!;
    expect(within(tech).getByText("Keine Meta Description gefunden.")).toBeTruthy();
    expect(within(tech).queryByText(/CTA erscheint erst am Seitenende/)).toBeNull();
    expect(within(ai).getByText(/CTA erscheint erst am Seitenende/)).toBeTruthy();
    expect(within(ai).queryByText("Keine Meta Description gefunden.")).toBeNull();
    expect(within(ai).getByText(/KI-generierte Interpretation/)).toBeTruthy();
    expect(within(ai).getByText(/ohne Einfluss auf den Score/)).toBeTruthy();
    expect(within(tech).getByText(/nicht KI-generiert/)).toBeTruthy();
  });

  it("colors findings by tone: critical, warning, passed", async () => {
    respondWith(status({ status: "completed" }), report());
    renderPage();
    await screen.findByText("Audit Report");
    expect(screen.getAllByTestId("finding-SEO_ROBOTS_NOINDEX")[0]!.dataset["tone"]).toBe(
      "critical",
    );
    expect(screen.getAllByTestId("finding-SEO_META_DESCRIPTION")[0]!.dataset["tone"]).toBe(
      "warning",
    );
    expect(screen.getAllByTestId("finding-SEO_TITLE")[0]!.dataset["tone"]).toBe("passed");
    const crit = screen.getByRole("heading", { name: "Critical Issues" }).closest("section")!;
    expect(within(crit).getByText("Seite ist auf noindex gesetzt.")).toBeTruthy();
    expect(within(crit).queryByText("Keine Meta Description gefunden.")).toBeNull();
  });

  it("lists recommended actions sorted by priority", async () => {
    respondWith(status({ status: "completed" }), report());
    renderPage();
    await screen.findByText("Audit Report");
    const sec = screen.getByRole("heading", { name: "Recommended Actions" }).closest("section")!;
    const items = within(sec)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items[0]).toContain("CTA nach oben verschieben");
    expect(items[1]).toContain("Meta Description ergänzen");
  });

  it("renders hostile AI/page text as plain text (no HTML injection)", async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const r = report();
    r.ai!.result!.executiveSummary = hostile;
    r.technical.findings[0]!.message = hostile;
    respondWith(status({ status: "completed" }), r);
    const { container } = renderPage();
    await screen.findByText("Audit Report");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("still shows technical findings when the AI failed or was skipped", async () => {
    const failed = report({
      ai: {
        status: "failed",
        provider: "anthropic",
        model: "m",
        promptVersion: "1",
        source: "ai",
        error: { code: "REFUSED", message: "Die KI hat die Bewertung abgelehnt." },
      },
      recommendedActions: [],
    });
    respondWith(status({ status: "completed" }), failed);
    renderPage();
    await screen.findByText("Audit Report");
    expect(
      screen.getByText(/Die KI-Bewertung ist nicht verfügbar: Die KI hat die Bewertung abgelehnt/),
    ).toBeTruthy();
    expect(screen.getByText(/davon nicht betroffen/)).toBeTruthy();
    expect(screen.getByText("Keine KI-Zusammenfassung verfügbar.")).toBeTruthy();
    expect(screen.getByText("Keine Empfehlungen verfügbar.")).toBeTruthy();
    expect(screen.getAllByTestId("finding-SEO_TITLE").length).toBeGreaterThan(0);
  });

  it("shows a positive note when there are no critical issues", async () => {
    respondWith(status({ status: "completed" }), report({ criticalIssues: [] }));
    renderPage();
    expect(await screen.findByText(/Keine kritischen technischen Befunde/)).toBeTruthy();
  });
});

describe("AuditPage – lifecycle", () => {
  it("shows a user-friendly message for failed audits", async () => {
    respondWith(
      status({
        status: "failed",
        error: { code: "TARGET_BLOCKED", message: "Das Ziel ist nicht erlaubt." },
      }),
    );
    renderPage();
    expect(await screen.findByText("Audit fehlgeschlagen")).toBeTruthy();
    expect(screen.getByText(/aus Sicherheitsgründen nicht abgerufen/)).toBeTruthy();
  });

  it("shows an error for unknown audits", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: { code: "NOT_FOUND", message: "Audit nicht gefunden." } }),
    );
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toContain("Audit nicht gefunden.");
  });

  it("polls until the audit completes, then loads the report", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/report")) return jsonResponse(200, report());
      calls++;
      return jsonResponse(
        200,
        status({ status: calls === 1 ? "queued" : calls === 2 ? "running" : "completed" }),
      );
    });
    renderPage();
    expect(await screen.findByText("Audit wartet in der Warteschlange …")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2100);
    expect(await screen.findByText("Analyse läuft …")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3200);
    await waitFor(() => expect(screen.getByText("Audit Report")).toBeTruthy());
    expect(calls).toBe(3);
  });

  it("stops polling when unmounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(async () => jsonResponse(200, status({ status: "running" })));
    const { unmount } = renderPage();
    await screen.findByText("Analyse läuft …");
    const before = fetchMock.mock.calls.length;
    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
