import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import type { AuditErrorCode } from "@mcopilot/shared-types";
import { isBlockedIp } from "./ipGuard.js";
import { UrlValidationError, validateUrl, type UrlPolicy } from "./urlValidator.js";

export class FetchError extends Error {
  /** Nur gesetzt, wenn der Zielserver mit einem HTTP-Fehlerstatus geantwortet hat. */
  httpStatus?: number;
  constructor(
    readonly code: AuditErrorCode,
    message: string,
    options?: { cause?: unknown; httpStatus?: number },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FetchError";
    if (options?.httpStatus !== undefined) this.httpStatus = options.httpStatus;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeFetcherOptions extends UrlPolicy {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  userAgent: string;
  /** Austauschbar für Tests. Produktiv: dns.lookup. */
  resolver?: (hostname: string) => Promise<ResolvedAddress[]>;
  /** Austauschbar für Tests. Produktiv: isBlockedIp. Gibt true zurück, wenn gesperrt. */
  isIpBlocked?: (address: string, hostname: string) => boolean;
}

export interface FetchResult {
  finalUrl: string;
  redirectChain: string[];
  statusCode: number;
  contentType: string;
  html: string;
  bytes: number;
  durationMs: number;
  fetchedAt: string;
}

export interface FetchOptions {
  /** Erlaubte MIME-Typen (Standard: HTML). */
  allowedContentTypes?: readonly string[];
  /** Obergrenze der Antwortgröße (Standard: Konfiguration des Fetchers). */
  maxBytes?: number;
}

export interface PageFetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
}

const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

const defaultResolver = async (hostname: string): Promise<ResolvedAddress[]> => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
};

export class SafeFetcher implements PageFetcher {
  private readonly resolver: NonNullable<SafeFetcherOptions["resolver"]>;
  private readonly isIpBlocked: NonNullable<SafeFetcherOptions["isIpBlocked"]>;

  constructor(private readonly opts: SafeFetcherOptions) {
    this.resolver = opts.resolver ?? defaultResolver;
    this.isIpBlocked = opts.isIpBlocked ?? ((address) => isBlockedIp(address));
  }

  async fetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      return await this.run(rawUrl, controller.signal, started, options);
    } catch (err) {
      if (err instanceof FetchError) throw err;
      if (controller.signal.aborted)
        throw new FetchError("FETCH_TIMEOUT", "Zeitüberschreitung beim Abruf.");
      throw new FetchError("FETCH_FAILED", "Abruf fehlgeschlagen.", { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  private async run(
    rawUrl: string,
    signal: AbortSignal,
    started: number,
    options: FetchOptions,
  ): Promise<FetchResult> {
    const chain: string[] = [];
    let current = this.validate(rawUrl);

    for (let hop = 0; ; hop++) {
      chain.push(current.toString());
      const res = await this.request(current, signal);
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= this.opts.maxRedirects) {
          throw new FetchError("TOO_MANY_REDIRECTS", "Zu viele Weiterleitungen.");
        }
        let next: string;
        try {
          next = new URL(res.headers.location, current).toString();
        } catch {
          throw new FetchError("FETCH_FAILED", "Ungültiges Weiterleitungsziel.");
        }
        current = this.validate(next); // jeder Hop wird neu geprüft
        continue;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        throw new FetchError("FETCH_FAILED", `Zielserver antwortete mit HTTP ${status}.`, {
          httpStatus: status,
        });
      }

      const contentType = String(res.headers["content-type"] ?? "");
      const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!(options.allowedContentTypes ?? ALLOWED_CONTENT_TYPES).includes(mime)) {
        res.resume();
        throw new FetchError(
          "UNSUPPORTED_CONTENT_TYPE",
          options.allowedContentTypes
            ? "Unerwarteter Dateityp."
            : "Nur HTML-Seiten werden unterstützt.",
        );
      }

      const { buffer } = await this.readBody(res, signal, options.maxBytes ?? this.opts.maxBytes);
      return {
        finalUrl: current.toString(),
        redirectChain: chain,
        statusCode: status,
        contentType,
        html: decode(buffer, contentType),
        bytes: buffer.length,
        durationMs: Date.now() - started,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  private validate(raw: string): URL {
    try {
      return validateUrl(raw, this.opts);
    } catch (err) {
      if (err instanceof UrlValidationError) {
        throw new FetchError("TARGET_BLOCKED", "Das Ziel ist nicht erlaubt.", { cause: err });
      }
      throw err;
    }
  }

  /** DNS-Auflösung mit Prüfung aller Adressen; Verbindung erfolgt zur geprüften IP (kein Rebinding). */
  private readonly safeLookup: LookupFunction = (hostname, options, callback) => {
    this.resolver(hostname).then(
      (addresses) => {
        const first = addresses[0];
        if (!first || addresses.some((a) => this.isIpBlocked(a.address, hostname))) {
          callback(new FetchError("TARGET_BLOCKED", "Das Ziel ist nicht erlaubt."), "", 4);
          return;
        }
        if (options.all) {
          (callback as unknown as (e: null, a: ResolvedAddress[]) => void)(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (err: unknown) => callback(err as NodeJS.ErrnoException, "", 4),
    );
  };

  private request(url: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
    const mod = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(
        url,
        {
          method: "GET",
          agent: false,
          signal,
          lookup: this.safeLookup,
          headers: {
            "user-agent": this.opts.userAgent,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "accept-encoding": "gzip, deflate, br",
          },
        },
        resolve,
      );
      req.on("error", (err) => {
        // FetchError aus dem Lookup wird durchgereicht
        const cause = (err as { cause?: unknown }).cause;
        reject(err instanceof FetchError ? err : cause instanceof FetchError ? cause : err);
      });
      req.end();
    });
  }

  private readBody(
    res: http.IncomingMessage,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ buffer: Buffer }> {
    const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
    let stream: Readable = res;
    if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(createGunzip());
    else if (encoding === "deflate") stream = res.pipe(createInflate());
    else if (encoding === "br") stream = res.pipe(createBrotliDecompress());
    else if (encoding !== "identity") {
      res.destroy();
      return Promise.reject(new FetchError("FETCH_FAILED", "Nicht unterstützte Content-Encoding."));
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const fail = (err: unknown): void => {
        res.destroy();
        stream.destroy();
        reject(err);
      };
      signal.addEventListener(
        "abort",
        () => fail(new FetchError("FETCH_TIMEOUT", "Zeitüberschreitung beim Abruf.")),
        { once: true },
      );
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length; // nach Dekompression gezählt
        if (size > maxBytes) {
          fail(new FetchError("RESPONSE_TOO_LARGE", "Die Antwort ist zu groß."));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve({ buffer: Buffer.concat(chunks) }));
      stream.on("error", fail);
      res.on("error", fail);
    });
  }
}

function decode(buffer: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}
