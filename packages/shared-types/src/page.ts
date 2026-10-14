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
  buttons: { text: string }[];
  visibleText: string;
  wordCount: number;
}
