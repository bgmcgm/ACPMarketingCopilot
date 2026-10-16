import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isBlockedIp } from "../../apps/functions/src/fetcher/ipGuard.js";
import {
  FetchError,
  SafeFetcher,
  type ResolvedAddress,
  type SafeFetcherOptions,
} from "../../apps/functions/src/fetcher/safeFetcher.js";

let server: http.Server;
let port = 0;
const requestedPaths: string[] = [];

const HTML = "<html><head><title>ok</title></head><body><h1>Hi</h1></body></html>";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    requestedPaths.push(path);
    const html = { "content-type": "text/html; charset=utf-8" };
    if (path === "/ok") return void res.writeHead(200, html).end(HTML);
    if (path === "/gzip") {
      return void res.writeHead(200, { ...html, "content-encoding": "gzip" }).end(gzipSync(HTML));
    }
    if (path === "/gzip-bomb") {
      return void res
        .writeHead(200, { ...html, "content-encoding": "gzip" })
        .end(gzipSync("a".repeat(5_000_000)));
    }
    if (path === "/big") return void res.writeHead(200, html).end("a".repeat(3000));
    if (path === "/pdf")
      return void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF");
    if (path === "/404") return void res.writeHead(404, html).end("nope");
    if (path === "/hang") return; // antwortet nie
    if (path === "/r1") return void res.writeHead(302, { location: "/ok" }).end();
    if (path === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (path === "/to-loopback")
      return void res.writeHead(302, { location: "http://127.0.0.1/secret" }).end();
    if (path === "/to-metadata") {
      return void res
        .writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" })
        .end();
    }
    if (path === "/to-internal-dns")
      return void res.writeHead(302, { location: `http://internal.test:${port}/x` }).end();
    if (path === "/to-file")
      return void res.writeHead(302, { location: "file:///etc/passwd" }).end();
    if (path === "/robots.txt") {
      return void res
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("User-agent: *\nDisallow: /privat\nSitemap: https://ok.test/sitemap.xml");
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const resolver = async (host: string): Promise<ResolvedAddress[]> => {
  if (host === "ok.test") return [{ address: "127.0.0.1", family: 4 }];
  if (host === "internal.test") return [{ address: "10.0.0.5", family: 4 }];
  if (host === "rebind.test")
    return [
      { address: "127.0.0.1", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
  if (host === "empty.test") return [];
  throw new Error("ENOTFOUND");
};

// Nur der Test-Host darf Loopback ansprechen (der Server läuft lokal); alles andere nutzt die echte Sperrliste.
const make = (over: Partial<SafeFetcherOptions> = {}): SafeFetcher =>
  new SafeFetcher({
    allowedPorts: [80, 443, port],
    domainAllowlist: [],
    maxLength: 2048,
    timeoutMs: 2000,
    maxBytes: 1000 * 1000,
    maxRedirects: 3,
    userAgent: "test",
    resolver,
    isIpBlocked: (ip, host) => (host === "ok.test" ? false : isBlockedIp(ip)),
    ...over,
  });

const url = (path: string, host = "ok.test"): string => `http://${host}:${port}${path}`;

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "NO_ERROR";
  } catch (e) {
    return e instanceof FetchError ? e.code : `OTHER:${String(e)}`;
  }
};

describe("SafeFetcher – happy path", () => {
  it("fetches html", async () => {
    const r = await make().fetch(url("/ok"));
    expect(r.statusCode).toBe(200);
    expect(r.html).toContain("<h1>Hi</h1>");
    expect(r.redirectChain).toHaveLength(1);
  });
  it("decompresses gzip", async () => {
    expect((await make().fetch(url("/gzip"))).html).toBe(HTML);
  });
  it("follows redirects and records the chain", async () => {
    const r = await make().fetch(url("/r1"));
    expect(r.finalUrl).toBe(url("/ok"));
    expect(r.redirectChain).toEqual([url("/r1"), url("/ok")]);
  });
});

describe("SafeFetcher – SSRF", () => {
  it("blocks hosts resolving to private IPs without connecting", async () => {
    requestedPaths.length = 0;
    expect(await codeOf(make().fetch(url("/ok", "internal.test")))).toBe("TARGET_BLOCKED");
    expect(requestedPaths).toHaveLength(0);
  });
  it("blocks when ANY resolved address is private (rebinding mix)", async () => {
    expect(await codeOf(make().fetch(url("/ok", "rebind.test")))).toBe("TARGET_BLOCKED");
  });
  it("blocks hosts that resolve to nothing", async () => {
    expect(await codeOf(make().fetch(url("/ok", "empty.test")))).toBe("TARGET_BLOCKED");
  });
  it.each(["/to-loopback", "/to-metadata", "/to-internal-dns", "/to-file"])(
    "blocks redirect %s",
    async (path) => {
      expect(await codeOf(make().fetch(url(path)))).toBe("TARGET_BLOCKED");
    },
  );
  it("blocks initial blocked URLs", async () => {
    for (const u of [
      "http://127.0.0.1/",
      "http://localhost/",
      "file:///etc/passwd",
      "ftp://example.com/",
      "http://169.254.169.254/",
    ])
      expect(await codeOf(make().fetch(u)), u).toBe("TARGET_BLOCKED");
  });
  it("does not leak details in error messages", async () => {
    const err = await make()
      .fetch("http://10.0.0.1/")
      .then(
        () => null,
        (e: unknown) => e as FetchError,
      );
    expect(err?.message).toBe("Das Ziel ist nicht erlaubt.");
  });
});

describe("SafeFetcher – limits", () => {
  it("enforces redirect limit", async () => {
    expect(await codeOf(make().fetch(url("/loop")))).toBe("TOO_MANY_REDIRECTS");
  });
  it("enforces max response size", async () => {
    expect(await codeOf(make({ maxBytes: 1000 }).fetch(url("/big")))).toBe("RESPONSE_TOO_LARGE");
  });
  it("enforces size after decompression (gzip bomb)", async () => {
    expect(await codeOf(make({ maxBytes: 100_000 }).fetch(url("/gzip-bomb")))).toBe(
      "RESPONSE_TOO_LARGE",
    );
  });
  it("times out", async () => {
    expect(await codeOf(make({ timeoutMs: 200 }).fetch(url("/hang")))).toBe("FETCH_TIMEOUT");
  });
  it("rejects non-html content types", async () => {
    expect(await codeOf(make().fetch(url("/pdf")))).toBe("UNSUPPORTED_CONTENT_TYPE");
  });
  it("fails on HTTP errors", async () => {
    expect(await codeOf(make().fetch(url("/404")))).toBe("FETCH_FAILED");
  });
  it("fails on DNS errors", async () => {
    expect(await codeOf(make().fetch(url("/ok", "nxdomain.test")))).toBe("FETCH_FAILED");
  });
  it("honors the domain allowlist", async () => {
    expect(await codeOf(make({ domainAllowlist: ["example.com"] }).fetch(url("/ok")))).toBe(
      "TARGET_BLOCKED",
    );
  });
});

describe("SafeFetcher – Optionen für Textdateien (robots.txt, llms.txt)", () => {
  const plain = { allowedContentTypes: ["text/plain"] };

  it("ruft Textdateien ab, wenn der Typ ausdrücklich erlaubt ist", async () => {
    const r = await make().fetch(url("/robots.txt"), plain);
    expect(r.html).toContain("User-agent: *");
    expect(r.contentType).toMatch(/^text\/plain/);
  });

  it("Standard bleibt HTML: Textdateien werden ohne Freigabe abgelehnt, HTML bei Textfreigabe ebenso", async () => {
    expect(await codeOf(make().fetch(url("/robots.txt")))).toBe("UNSUPPORTED_CONTENT_TYPE");
    expect(await codeOf(make().fetch(url("/ok"), plain))).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("meldet HTTP-Fehlerstatus am Fehlerobjekt (404 = Datei fehlt)", async () => {
    const err = (await make()
      .fetch(url("/404"), plain)
      .catch((e: unknown) => e)) as FetchError;
    expect(err).toBeInstanceOf(FetchError);
    expect(err.code).toBe("FETCH_FAILED");
    expect(err.httpStatus).toBe(404);
  });

  it("kennt eine eigene Größenobergrenze pro Abruf", async () => {
    // /big liefert HTML; erst Größe prüfen, daher auch hier der HTML-Typ erlaubt
    const opts = { allowedContentTypes: ["text/html"], maxBytes: 1000 };
    expect(await codeOf(make({ maxBytes: 1_000_000 }).fetch(url("/big"), opts))).toBe(
      "RESPONSE_TOO_LARGE",
    );
  });

  it("die SSRF-Prüfungen gelten unverändert für Textdateien", async () => {
    expect(await codeOf(make().fetch("http://127.0.0.1/robots.txt", plain))).toBe("TARGET_BLOCKED");
    expect(await codeOf(make().fetch(url("/robots.txt", "internal.test"), plain))).toBe(
      "TARGET_BLOCKED",
    );
  });
});
