/**
 * PageSnapshot: gekappter, öffentlicher Seiteninhalt + extrahierte Signale.
 * Einzige Eingabe der Rules Engine. Enthält keine Formularwerte/personenbezogenen Daten.
 */
export interface HeadingInfo {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

export interface LinkInfo {
  href: string;
  text: string;
  rel: string | null;
}

export interface ScriptInfo {
  src: string | null;
  type: string | null;
  /** Inline-Skripte: nur gekappter Inhalt für Mustererkennung, nicht für die Speicherung. */
  inlineContent: string | null;
  attributes: Record<string, string>;
}

export interface FormFieldInfo {
  type: string;
}

export interface FormInfo {
  method: string;
  action: string | null;
  fields: FormFieldInfo[];
  hasConsentCheckbox: boolean;
}

export interface ImageInfo {
  src: string | null;
  alt: string | null;
}

/** Strukturierte Daten (JSON-LD), reduziert auf die für GEO relevanten Merkmale. */
export interface JsonLdSummary {
  types: string[];
  hasOrganization: boolean;
  /** Anzahl sameAs-Verweise der Organisation/Person (Profile, Wikipedia, Wikidata …). */
  sameAsCount: number;
  hasAuthor: boolean;
  hasDatePublished: boolean;
  hasDateModified: boolean;
  hasFaq: boolean;
}

/** Inhaltliche Struktursignale, die Antwortsysteme beim Extrahieren und Zitieren unterstützen. */
export interface ContentSignals {
  questionHeadings: number;
  /** Listen (ul/ol) mit mindestens 3 Einträgen. */
  lists: number;
  tables: number;
  detailsElements: number;
  /** Elemente mit data-nosnippet. */
  nosnippetElements: number;
  hasAuthorMeta: boolean;
  timeElements: number;
  hasPublishedMeta: boolean;
  hasModifiedMeta: boolean;
}

/** Ergebnis des Abrufs einer Site-Datei (robots.txt, llms.txt). */
export interface SiteFile {
  /** missing = existiert nicht (404/keine Textdatei); unavailable = Abruf nicht möglich (Fehler, gesperrt). */
  status: "found" | "missing" | "unavailable";
  /** Gekappter Inhalt, nur im Speicher für die Auswertung – wird nicht gespeichert. */
  content?: string;
}

export interface SiteSignals {
  robotsTxt: SiteFile;
  llmsTxt: SiteFile;
}

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  statusCode: number;
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  viewport: string | null;
  openGraph: Record<string, string>;
  hreflang: string[];
  headings: HeadingInfo[];
  images: ImageInfo[];
  links: LinkInfo[];
  scripts: ScriptInfo[];
  forms: FormInfo[];
  jsonLdTypes: string[];
  jsonLd: JsonLdSummary;
  contentSignals: ContentSignals;
  /** Fehlt, wenn die Site-Dateien nicht geprüft wurden. */
  site?: SiteSignals;
  buttons: { text: string }[];
  visibleText: string;
  wordCount: number;
}
