// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage, normalizeInputUrl } from "../../apps/web/src/pages/HomePage";
import { jsonResponse } from "./fixtures";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const Target = (): JSX.Element => <p>Audit {useParams()["id"]}</p>;
const renderHome = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/audits/:id" element={<Target />} />
      </Routes>
    </MemoryRouter>,
  );

describe("normalizeInputUrl", () => {
  it("adds https:// only when no scheme is present", () => {
    expect(normalizeInputUrl(" example.com/a ")).toBe("https://example.com/a");
    expect(normalizeInputUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeInputUrl("file:///etc/passwd")).toBe("file:///etc/passwd"); // Server lehnt ab
    expect(normalizeInputUrl("")).toBe("");
  });
});

describe("HomePage", () => {
  it("shows the start page with all modules preselected", () => {
    renderHome();
    expect(screen.getByRole("heading", { name: "Website Auditor" })).toBeTruthy();
    for (const label of [
      "SEO",
      "Tracking",
      "Consent",
      "Content",
      "Conversion",
      "GEO / KI-Sichtbarkeit",
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.getByRole("button", { name: "Analyze Website" })).toBeTruthy();
  });

  it("submits the url with the selected modules and navigates to the audit", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { id: "abc", status: "queued" }));
    renderHome();
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "example.com/landing" } });
    fireEvent.click(screen.getByLabelText("Consent"));
    fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
    await screen.findByText("Audit abc");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({
      url: "https://example.com/landing",
      modules: ["seo", "tracking", "content", "conversion", "geo"],
    });
  });

  it("validates input before calling the API", async () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Bitte eine URL eingeben.");
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "example.com" } });
    for (const label of [
      "SEO",
      "Tracking",
      "Consent",
      "Content",
      "Conversion",
      "GEO / KI-Sichtbarkeit",
    ])
      fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("mindestens ein Modul"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows server-side rejections (e.g. blocked target) and allows retry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "URL_NOT_ALLOWED", message: "Diese IP-Adresse ist nicht erlaubt." },
      }),
    );
    renderHome();
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "http://127.0.0.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Diese IP-Adresse ist nicht erlaubt.",
    );
    expect(
      (screen.getByRole("button", { name: "Analyze Website" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
