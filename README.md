# Marketing Copilot – Website Auditor

Internes Tool: öffentliche Website analysieren (SEO, Tracking, Consent-Indikatoren, Content, Conversion).
Technische Messwerte (Rules Engine, deterministisch) und KI-Bewertung (Claude) sind strikt getrennt.

Architektur und Entscheidungen: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Einrichtung: [`docs/runbook.md`](docs/runbook.md) · Datenschutz: [`docs/privacy-review.md`](docs/privacy-review.md) · Lücken: [`docs/known-gaps.md`](docs/known-gaps.md)

## Status

| Inkrement | Inhalt                                                               | Stand                                          |
| --------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| 0–1       | Monorepo, CI, `shared-types`                                         | fertig                                         |
| 2         | HTML-Analyzer, Rules Engine (29 Regeln)                              | fertig                                         |
| 3         | Scoring (konfigurierbar)                                             | fertig                                         |
| 4         | SSRF-sicherer URL-Validator + Fetcher                                | fertig                                         |
| 5         | Config, Persistenz, Auth, HTTP-API, Quoten                           | fertig                                         |
| 6         | Worker-Pipeline (ohne KI), Idempotenz, Poison-Handling               | fertig                                         |
| 7         | KI-Bewertung (Claude, strukturierte JSON-Ausgabe)                    | fertig (nur gegen Test-Doubles geprüft)        |
| 8         | Frontend (React, Tailwind): Start, Report, Verlauf                   | fertig (Browser-Prüfung nur mit gemockter API) |
| 9         | Bicep (dev/prod), Runbook – lokal nur übersetzt, nicht deployt       | fertig (ungetestet in Azure)                   |
| 10        | GitHub-Actions-Pipelines (OIDC, dev auto / prod mit Freigabe)        | fertig (nie gelaufen)                          |
| 11        | Hardening, Datenschutz-Review, Smoke-Test, bekannte Lücken (`docs/`) | fertig                                         |

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

## Lokal entwickeln (ohne Azure)

Voraussetzung: Node 22, Git. Dann:

```
npm install
npm run dev
```

- Oberfläche: `http://localhost:5173` (lädt bei Änderungen im Frontend sofort neu)
- API/Backend: `http://localhost:7071` (startet bei Änderungen am Backend automatisch neu)
- Daten liegen nur im Arbeitsspeicher; kein Login (fester Demo-Benutzer).
- KI-Bewertung (optional): `.env.example` nach `.env.local` kopieren und `AI_MODEL` sowie `ANTHROPIC_API_KEY` eintragen. Ohne diese Werte ist die KI ausgeschaltet.

Vor jedem Commit: `npm test && npm run lint && npm run typecheck`.

Typische Änderungen:

| Ich will …                           | Datei                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------ |
| eine Prüfregel ändern oder ergänzen  | `apps/functions/src/rules/<kategorie>.ts` (+ Test in `tests/rules/`)     |
| Gewichtung des Scores ändern         | `apps/functions/src/scoring/scoring.ts` (`defaultScoringConfig`)         |
| Texte/Aussehen der Oberfläche ändern | `apps/web/src/pages/` und `apps/web/src/components/`                     |
| den KI-Prompt anpassen               | `apps/functions/src/ai/prompt.ts` (Version `PROMPT_VERSION` mit erhöhen) |

Für mehrere Personen auf einem eigenen Server (ohne Azure, Passwortschutz, nur internes Netz): [`docs/pilot-server.md`](docs/pilot-server.md).

Später in Azure: Der Code bleibt unverändert, es kommt nur die Infrastruktur dazu (`docs/runbook.md`).

**Demo-Modus (ohne Azure, ohne Zugangsdaten):** `npm install && npm run demo`, dann `http://localhost:7071` öffnen. Es läuft die echte Anwendungslogik (Abruf mit SSRF-Schutz, Analyse, Regeln, Score, API, Worker, Oberfläche); nur Cosmos DB, Queue und Login sind durch Arbeitsspeicher bzw. einen festen Demo-Benutzer ersetzt. Daten sind nach Neustart weg. Die KI-Bewertung läuft nur, wenn `AI_MODEL` und `ANTHROPIC_API_KEY` in der Shell gesetzt sind, sonst ist sie ausgeschaltet. Der Demo-Code liegt in `apps/functions/src/dev/` und ist nicht im Deploy-Paket.

Wo lese ich was?

- Prüfregeln: `apps/functions/src/rules/` (eine Datei je Kategorie)
- Score-Berechnung: `apps/functions/src/scoring/`
- Seitenabruf/SSRF-Schutz: `apps/functions/src/fetcher/`
- Was getestet wird: `tests/`

Änderungen: eigenen Branch anlegen, `npm test && npm run lint && npm run typecheck`, pushen.
