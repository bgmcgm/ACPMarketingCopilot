import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "../../apps/functions/src/rules/robots.js";

const allowed = (txt: string, ua: string, path = "/"): boolean =>
  isAllowed(parseRobots(txt), ua, path);

describe("robots.txt – Parser und Auswertung (RFC 9309)", () => {
  it("ohne Regeln ist alles erlaubt; Disallow: / sperrt alles", () => {
    expect(allowed("", "GPTBot")).toBe(true);
    expect(allowed("User-agent: *\nDisallow:", "GPTBot")).toBe(true); // leeres Disallow = alles erlaubt
    expect(allowed("User-agent: *\nDisallow: /", "GPTBot", "/seite")).toBe(false);
  });

  it("spezifische Gruppe schlägt '*'; Namen sind nicht groß-/kleinschreibungsabhängig", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /";
    expect(allowed(txt, "gptbot")).toBe(true);
    expect(allowed(txt, "GPTBOT")).toBe(true);
    expect(allowed(txt, "ClaudeBot")).toBe(false);
  });

  it("mehrere User-agent-Zeilen bilden eine Gruppe", () => {
    const txt = "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /privat";
    expect(allowed(txt, "GPTBot", "/privat/x")).toBe(false);
    expect(allowed(txt, "ClaudeBot", "/privat/x")).toBe(false);
    expect(allowed(txt, "PerplexityBot", "/privat/x")).toBe(true);
  });

  it("längste Übereinstimmung gewinnt, bei Gleichstand gilt Allow", () => {
    const txt = "User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /c\nAllow: /c";
    expect(allowed(txt, "x", "/a/x")).toBe(false);
    expect(allowed(txt, "x", "/a/b/x")).toBe(true);
    expect(allowed(txt, "x", "/c")).toBe(true);
  });

  it("unterstützt * und $ in Mustern", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/private";
    expect(allowed(txt, "x", "/doc/file.pdf")).toBe(false);
    expect(allowed(txt, "x", "/doc/file.pdf?x=1")).toBe(true);
    expect(allowed(txt, "x", "/tmp123/private")).toBe(false);
    expect(allowed(txt, "x", "/other")).toBe(true);
  });

  it("ignoriert Kommentare, Groß-/Kleinschreibung der Direktiven, BOM und Windows-Zeilenenden", () => {
    const txt = "﻿# Kommentar\r\nUSER-AGENT: GPTBot # inline\r\nDISALLOW: /x # nochmal\r\n";
    expect(allowed(txt, "GPTBot", "/x/1")).toBe(false);
    expect(allowed(txt, "GPTBot", "/y")).toBe(true);
  });

  it("führt mehrere Gruppen desselben Crawlers zusammen", () => {
    const txt = "User-agent: GPTBot\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /b";
    expect(allowed(txt, "GPTBot", "/a")).toBe(false);
    expect(allowed(txt, "GPTBot", "/b")).toBe(false);
    expect(allowed(txt, "GPTBot", "/c")).toBe(true);
  });

  it("andere Direktiven wie Crawl-delay und Sitemap beenden die Gruppe nicht und werden gesammelt", () => {
    const txt =
      "User-agent: GPTBot\nCrawl-delay: 5\nSitemap: https://example.com/sitemap.xml\nDisallow: /";
    expect(allowed(txt, "GPTBot")).toBe(false);
    expect(parseRobots(txt).sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("Regeln ohne vorherige User-agent-Zeile werden ignoriert; kein Absturz bei Müll", () => {
    expect(allowed("Disallow: /\nblabla\n:::", "GPTBot")).toBe(true);
    expect(() => parseRobots("\u0000\u0001 ::: \n".repeat(1000))).not.toThrow();
  });

  it("Regex-Sonderzeichen im Muster werden maskiert", () => {
    expect(allowed("User-agent: *\nDisallow: /a.b(c)", "x", "/aXb(c)")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a.b(c)", "x", "/a.b(c)")).toBe(false);
  });
});
