# Bekannte Lücken und ungeprüfte Annahmen (Stand Inkrement R1)

Ehrliche Liste dessen, was **nicht** verifiziert ist oder bewusst fehlt. Nichts davon wurde gegen echtes Azure, Entra ID oder die Claude-API ausgeführt.

## Nie gegen die echte Umgebung gelaufen

- Bicep-Deployment (nur `bicep build/lint`), GitHub-Workflows (nur `actionlint`), Entra-Login, Linked Backend, Key-Vault-Referenzen, Flex-Consumption-Deployment, Queue-Trigger-Anbindung der Function App.
- Claude-API-Aufruf (nur gegen Test-Client): Schema-Akzeptanz durch die API, Antwortqualität, Latenz, Kosten pro Audit.
- Cosmos-Adapter nur gegen einen aufzeichnenden Stub (kein Emulator verfügbar); Queue-Adapter dagegen gegen Azurite getestet.
- Frontend nur mit gemockter API im Browser gesehen.

## Annahmen, die den ersten DEV-Deploy kippen können

Siehe `docs/runbook.md` Abschnitt 6. Besonders kritisch: Flex Consumption als SWA-Linked-Backend und die Absicherung der Function App gegen direkten Zugriff (sonst Principal-Header fälschbar) – `scripts/smoke-test.mjs` prüft das nach dem Deploy und läuft in der Pipeline.

## Funktionale Grenzen (bewusst, MVP)

- Nur statisches HTML: per JavaScript nachgeladene Skripte/Banner/Formulare und Verhalten nach Interaktion werden nicht erkannt; Ergebnisse heißen „im initialen HTML erkannt“.
- Eine URL pro Audit, kein Crawl, kein robots.txt-Handling, keine Zeichensatz-Erkennung über `<meta charset>`.
- Benutzer sehen nur eigene Audits (kein Team-Dashboard).
- Keine Ratenbegrenzung über Quoten pro Benutzer hinaus (Kosten-/Missbrauchsschutz auf Audit-Ebene, kein globales Limit).
- Kein Fallback-Modell bei Ablehnung durch Claude (Audit bleibt gültig, KI-Teil `failed`).
- Kein Retention-Job für Log-Daten über die Workspace-Einstellung hinaus; kein Backup-Konzept für Cosmos über den Standard hinaus.
- Deployment-Paket der Functions ist ~139 MB (Azure-SDKs); Kaltstart nicht gemessen.

## Betrieb

- Keine Lasttests, keine Messung von Kosten (Cosmos RU, Claude-Tokens, Flex-Ausführung).
- Alarme (prod) decken Exceptions und Poison-Queue ab, nicht Audit-Fehlerquote oder KI-Ausfallrate.
- Actions auf Major-Versionen gepinnt, nicht auf SHAs; Abhängigkeits-Updates manuell (kein Dependabot konfiguriert).
- Private Endpoints/VNet nicht umgesetzt.

## Abhängigkeiten

- `npm audit --omit=dev`: 0 bekannte Schwachstellen (Stand Inkrement 11).
- `npm audit` inklusive Dev-Abhängigkeiten meldet Treffer (u. a. Test-Toolchain: vitest/vite/esbuild, azurite, tinypool). Betrifft nur Entwicklung/CI, nicht das ausgelieferte Paket; Upgrade der Toolchain steht aus (Vitest-Major-Update).

## GEO / KI-Sichtbarkeit

- Gemessen werden technische Voraussetzungen im initialen HTML sowie robots.txt/llms.txt – **nicht**, ob eine Marke oder Seite in ChatGPT, Perplexity, Claude oder Google-KI-Antworten tatsächlich genannt wird.
- Die Crawler-Liste (`rules/geo.ts`, Stand Oktober 2026) muss regelmäßig gegen die Herstellerdokumentation geprüft werden; Namen und Zuständigkeiten ändern sich.
- llms.txt ist eine junge Konvention ohne bestätigte Wirkung bei großen Anbietern und deshalb nur ein Hinweis.
- Strukturierte Daten werden nur als JSON-LD erkannt (kein Microdata/RDFa).
- Die Aussage "viele KI-Crawler führen kein JavaScript aus" ist eine verbreitete Beobachtung, kein von uns geprüftes Verhalten; die Schwellenwerte der Regel (Wörter/Skripte) sind Heuristiken.
- Ältere gespeicherte Audits enthalten kein GEO-Ergebnis; ihr Gesamtscore wurde mit den alten Gewichten (SEO 25 …) berechnet.

## Reviews-Modul (Inkrement R1)

Nichts davon wurde gegen ein echtes Google-Konto oder echtes Azure ausgeführt; alle Tests laufen gegen Test-Doubles (`FakeGoogleClient`, In-Memory-Repositories) oder gegen einen gemockten `fetch`.

- **Nie gegen die echte Google-API gelaufen:** Endpunkt-URLs, Feldformen und das Scope `business.manage` von `connectors/googleBusinessProfile/` sind \[ANNAHME\] Stand Oktober 2026 (siehe ARCHITECTURE.md B6). Google hat diese APIs mehrfach umbenannt/aufgeteilt; vor dem ersten echten Aufruf gegen die aktuelle Dokumentation und ein Google-Business-Profile-Testkonto verifizieren.
- **Business-Profile-API-Zugriff ist bei Google selbst freigabepflichtig:** Neue Google-Cloud-Projekte benötigen für die Business-Profile-APIs in der Regel eine gesonderte Freigabe durch Google (Antragsformular, Wartezeit) – das ist ein externer Vorgang, den dieses Repository nicht auslösen oder beschleunigen kann.
- **OAuth-Consent-Screen und App-Verifizierung:** Mit dem Scope `business.manage` verlangt Google je nach Nutzerzahl eine OAuth-App-Verifizierung (Branding-Prüfung, ggf. Sicherheits-Assessment). Nicht Teil dieses Inkrements.
- **Kein Scheduler:** Reviews werden nur durch einen manuellen "Jetzt synchronisieren"-Aufruf abgerufen (R3); kein Timer-Trigger.
- **Token-Verschlüsselung ohne Rotation:** `TOKEN_ENCRYPTION_KEY` wird einmalig gesetzt; es gibt keinen Rotationsmechanismus (alle verschlüsselten Refresh-Token müssten bei einer Rotation neu verschlüsselt werden).
- **Keine Bicep-/Infrastruktur-Änderungen:** Die neuen Cosmos-Container (`clients`, `reviews`) und Key-Vault-Secrets (`GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_STATE_SECRET`, `TOKEN_ENCRYPTION_KEY`) existieren nur als Konfigurationserwartung (`config.ts`), nicht als Bicep-Ressourcen – wie beim Auditor selbst folgt Infrastruktur erst, nachdem die Anwendungslogik steht.
- **Frontend nur mit gemockter/In-Memory-API gesehen**, nicht im Browser gegen eine echte Function App.
- **Social-Media-Posts, lokale SEO/GMB-Stammdaten-Pflege, Newsletter** (die übrigen drei angefragten Fähigkeiten) sind nicht Teil dieses Inkrements; sie sollen auf demselben Fundament (Client, Connector-Pattern, Freigabe-Gate) aufsetzen.
