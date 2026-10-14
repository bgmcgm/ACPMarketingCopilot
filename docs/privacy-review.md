# Datenschutz-Review (technische Sicht)

Stand: Inkrement 11. **Keine Rechtsberatung.** Dieses Dokument beschreibt, welche Daten das System verarbeitet, und listet offene Punkte, die Datenschutz/Legal klären müssen, bevor produktive Daten fließen.

## 1. Datenfluss und Speicherorte

| Daten                                                                | Quelle              | Wo gespeichert                                                                 | Dauer                     | Empfänger                                             |
| -------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ | ------------------------- | ----------------------------------------------------- |
| Entra-`userId` (oid)                                                 | Login (SWA)         | Cosmos (`ownerId`), App-Insights-Telemetrie (nur wenn geloggt – aktuell nicht) | Audit-TTL 90 Tage         | –                                                     |
| Eingegebene URL                                                      | Benutzer            | Cosmos (`input.url`, `normalizedUrl`)                                          | 90 Tage                   | –                                                     |
| Seiteninhalt (Titel, Meta, Überschriften, Textauszug ≤ 6000 Zeichen) | öffentliche Website | Cosmos (`page`)                                                                | 90 Tage                   | Anthropic (Textauszug ≤ 4000 Zeichen + Überschriften) |
| Technische Befunde, Score                                            | Rules Engine        | Cosmos                                                                         | 90 Tage                   | Anthropic (Befunde als Kontext)                       |
| KI-Bewertung                                                         | Anthropic           | Cosmos (`ai`)                                                                  | 90 Tage                   | –                                                     |
| Queue-Nachricht                                                      | System              | Storage Queue (nur `auditId`, `ownerId`)                                       | bis zur Verarbeitung      | –                                                     |
| Logs/Telemetrie                                                      | Functions           | Log Analytics / App Insights                                                   | 30 (dev) / 90 (prod) Tage | –                                                     |

**Nicht** erfasst: Formularwerte, `value`-Attribute, Cookies, Request-Header der Zielseite, Skriptinhalte (Inline-Skripte werden nur zur Mustererkennung im Speicher gelesen und nicht gespeichert), IP-Adressen der Benutzer im Audit-Dokument.

## 2. Maßnahmen im Code

- Formulare: nur Anzahl, Methode, Feldtypen, Vorhandensein einer Einwilligungs-Checkbox (Test: `tests/rules`, `tests/integration/pipeline.test.ts`).
- Claude erhält nur Titel, Meta Description, Sprache, Überschriften, gekürzten Text und Findings – keine Links, Skripte, Formulardaten (Test: `pipeline.test.ts` „passes only page excerpt …").
- Logs enthalten URLs nur ohne Query-String/Fragment (`lib/redact.ts`, Test in `hardening.test.ts`), keine Seiteninhalte.
- Fehlermeldungen an Clients sind generisch (kein Leak interner Details).
- Benutzer sehen nur eigene Audits (Partition `ownerId`, fremde IDs → 404). Löschen jederzeit möglich (`DELETE /api/audits/{id}`); automatische Löschung per TTL.
- Keine Cosmos-/Storage-Schlüssel; Zugriff über Managed Identity.

## 3. Restrisiken und offene Punkte

| #   | Punkt                                                                                                                                                        | Einschätzung / Empfehlung                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **URLs können Personenbezug/Tokens enthalten** (z. B. `?email=…`, Einmal-Links), die Benutzer einfügen. Die Original-URL wird 90 Tage in Cosmos gespeichert. | Hinweis in der UI („Keine URLs mit Zugangsdaten/Personendaten eingeben“) ergänzen; ggf. Query-Strings vor dem Speichern abschneiden (Produktentscheidung).                                                                          |
| 2   | **Auftragsverarbeitung Anthropic:** Seitentext verlässt die Azure-Umgebung. Öffentliche Inhalte, aber ggf. Personenbezug (Namen im Text).                    | AVV/DPA, Datenresidenz und Aufbewahrung/Training-Nutzung bei Anthropic klären; Alternative Claude über Microsoft Foundry prüfen (Provider-Interface erlaubt Austausch).                                                             |
| 3   | **Prompt-Injection:** Seitentext ist unvertraut.                                                                                                             | Architektonisch begrenzt (Schema-Validierung, keine Tools, KI beeinflusst weder Messwerte noch Score); Texte im UI werden nie als HTML gerendert. Restrisiko: irreführende KI-Aussagen → UI kennzeichnet sie als KI-Interpretation. |
| 4   | **Consent-Ergebnisse** sind Indikatoren aus statischem HTML, kein Rechtsurteil.                                                                              | UI-Hinweis vorhanden; Legal sollte die Formulierung freigeben.                                                                                                                                                                      |
| 5   | **Rechtsgrundlage/Verzeichnis der Verarbeitungstätigkeiten, Betriebsrat/Mitbestimmung** (Nutzungsprotokoll interner Benutzer).                               | Organisatorisch klären.                                                                                                                                                                                                             |
| 6   | **Zugriff auf Daten durch Administratoren** (Cosmos-Portal, Log Analytics).                                                                                  | Rollenkonzept (RBAC) für Azure-Zugriff festlegen; Data-Plane-Zugriff nur für die Function-Identität vergeben (so im Template).                                                                                                      |
| 7   | **Abruf fremder Websites** durch Azure-IPs; kein robots.txt-Handling.                                                                                        | User-Agent identifiziert das Tool; Einzelabrufe. Bei Beschwerden robots.txt-Respektierung nachrüsten.                                                                                                                               |
| 8   | **Public Network Access** für Cosmos/Key Vault/Storage im MVP aktiv.                                                                                         | Authentifizierung ist nur per Entra ID möglich; für höhere Anforderungen Private Endpoints (größerer Umbau, nicht im MVP).                                                                                                          |
