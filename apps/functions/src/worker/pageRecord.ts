import type { PageSnapshot } from "@mcopilot/shared-types";
import type { AuditDocument } from "../domain/auditDocument.js";

const MAX_EXCERPT_CHARS = 6000;
const MAX_HEADINGS = 60;
const MAX_HEADING_CHARS = 200;

/** Reduziert den Snapshot auf den zu speichernden, gekappten öffentlichen Seiteninhalt. */
export function toPageRecord(page: PageSnapshot): NonNullable<AuditDocument["page"]> {
  return {
    title: page.title,
    metaDescription: page.metaDescription,
    canonical: page.canonical,
    lang: page.lang,
    headings: page.headings
      .slice(0, MAX_HEADINGS)
      .map((h) => ({ level: h.level, text: h.text.slice(0, MAX_HEADING_CHARS) })),
    wordCount: page.wordCount,
    visibleTextExcerpt: page.visibleText.slice(0, MAX_EXCERPT_CHARS),
  };
}
