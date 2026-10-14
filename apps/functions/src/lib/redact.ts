/**
 * Entfernt Query-String und Fragment für Logs: URLs, die Benutzer einfügen, können Tokens
 * oder personenbezogene Daten in Parametern enthalten. Gibt nie den Originalwert zurück.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[ungültige URL]";
  }
}
