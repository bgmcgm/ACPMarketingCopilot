import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiClientError, setUnauthorizedHandler } from "../../apps/web/src/lib/api";

const json = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("creates audits via POST /api/audits with a JSON body", async () => {
    fetchMock.mockResolvedValue(json(202, { id: "a1", status: "queued" }));
    const res = await api.createAudit("https://example.com", ["seo"]);
    expect(res).toEqual({ id: "a1", status: "queued" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/audits");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ url: "https://example.com", modules: ["seo"] });
    expect(init.credentials).toBe("same-origin");
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("encodes ids and supports DELETE with 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteAudit("a/b")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/audits/a%2Fb");
    expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
  });

  it("passes list paging parameters", async () => {
    fetchMock.mockResolvedValue(json(200, { items: [] }));
    await api.listAudits(5, "tok en");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/audits?limit=5&continuationToken=tok+en");
  });

  it("maps API errors to ApiClientError with code, message and correlation id", async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        error: {
          code: "URL_NOT_ALLOWED",
          message: "Dieser Port ist nicht erlaubt.",
          correlationId: "c1",
        },
      }),
    );
    const err = (await api.createAudit("x", ["seo"]).catch((e: unknown) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 400, code: "URL_NOT_ALLOWED", correlationId: "c1" });
    expect(err.message).toBe("Dieser Port ist nicht erlaubt.");
  });

  it("handles non-JSON error pages and network failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status: 502 }));
    await expect(api.getAudit("a")).rejects.toMatchObject({ status: 502, code: "HTTP_ERROR" });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(api.getAudit("a")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("triggers the login redirect on 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { error: { code: "UNAUTHENTICATED", message: "x" } }));
    await expect(api.listAudits()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
  });
});
