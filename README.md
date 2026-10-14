# Marketing Copilot – Website Auditor

Internes Tool: öffentliche Website analysieren (SEO, Tracking, Consent-Indikatoren, Content, Conversion).
Technische Messwerte (Rules Engine, deterministisch) und KI-Bewertung (Claude) sind strikt getrennt.

Architektur und Entscheidungen: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Status

| Inkrement | Inhalt                                                         | Stand                                          |
| --------- | -------------------------------------------------------------- | ---------------------------------------------- |
| 0–1       | Monorepo, CI, `shared-types`                                   | fertig                                         |
| 2         | HTML-Analyzer, Rules Engine (29 Regeln)                        | fertig                                         |
| 3         | Scoring (konfigurierbar)                                       | fertig                                         |
| 4         | SSRF-sicherer URL-Validator + Fetcher                          | fertig                                         |
| 5         | Config, Persistenz, Auth, HTTP-API, Quoten                     | fertig                                         |
| 6         | Worker-Pipeline (ohne KI), Idempotenz, Poison-Handling         | fertig                                         |
| 7         | KI-Bewertung (Claude, strukturierte JSON-Ausgabe)              | fertig (nur gegen Test-Doubles geprüft)        |
| 8         | Frontend (React, Tailwind): Start, Report, Verlauf             | fertig (Browser-Prüfung nur mit gemockter API) |
| 9         | Bicep (dev/prod), Runbook – lokal nur übersetzt, nicht deployt | fertig (ungetestet in Azure)                   |
| 10–11     | Pipelines, Hardening                                           | offen                                          |

## Struktur

```
apps/functions/     Azure Functions (API + Worker), TypeScript
apps/web/           React-Frontend (Vite, Tailwind)
packages/shared-types/  gemeinsame Typen + zod-Schemas
tests/              rules/, crawler/, integration/ (Vitest)
infrastructure/     Bicep (main.bicep, modules/, parameters/)
docs/               Architektur, Entscheidungen
```

## Lokal arbeiten

Voraussetzung: Node 22, Git.

```
npm install
npm test          # alle Tests
npm run typecheck # TypeScript (strict)
npm run lint
```

Frontend lokal ansehen (nur Oberfläche, ohne Backend): `npm run dev -w @mcopilot/web`. Mit Login-Emulation und API: Azure Static Web Apps CLI (`swa start`) – folgt mit den Deploy-Skripten.

Wo lese ich was?

- Prüfregeln: `apps/functions/src/rules/` (eine Datei je Kategorie)
- Score-Berechnung: `apps/functions/src/scoring/`
- Seitenabruf/SSRF-Schutz: `apps/functions/src/fetcher/`
- Was getestet wird: `tests/`

Änderungen: eigenen Branch anlegen, `npm test && npm run lint && npm run typecheck`, pushen.
