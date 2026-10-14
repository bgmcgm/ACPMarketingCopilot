# Marketing Copilot – Modul "Marketing Website Auditor"

## Solution Architecture (Schritt 1)

Status: Entwurf zur Freigabe · Stand: 2026-10-14

Konvention: **[ANNAHME]** = Azure-/Entra-/Claude-Verhalten, das vor der Umsetzung gegen die aktuelle Microsoft-/Anthropic-Dokumentation verifiziert werden muss. **[ENTSCHEIDUNG]** = bewusste MVP-Entscheidung (siehe Abschnitt 11).

---

## 1. Zielbild & Leitprinzipien

1. **Messen ≠ Interpretieren.** Technische Findings entstehen ausschließlich deterministisch in der Rules Engine. Claude liefert nur eine getrennte, als KI gekennzeichnete Marketing-Bewertung. Der Score wird nie von Claude beeinflusst.
2. **Claude ist read-only gegenüber Messwerten.** Claude bekommt Findings als Kontext, die Antwort wird gegen ein Schema validiert, das keine Felder für Findings/Scores enthält. Technische Findings werden im UI immer aus der Datenbank gerendert, nie aus der KI-Antwort.
3. **Teilergebnisse sind gültige Ergebnisse.** Fällt Claude aus, ist das Audit trotzdem `completed` (mit `ai.status = failed`); der technische Report bleibt nutzbar.
4. **Secure by default.** Keine Secrets im Repo, Managed Identity überall wo möglich, SSRF-Schutz im Fetcher als zentrale Sicherheitskomponente.
5. **Einfachste robuste Lösung.** Kein SignalR, kein Headless-Browser, keine Durable Functions im MVP.

---

## 2. Komponentenübersicht

```
Browser (React SPA)
   │  Login (OIDC)                      ┌──────────────────────┐
   ├──────────────────────────────────► │ Microsoft Entra ID   │
   │                                    └──────────────────────┘
   ▼
Azure Static Web App (Standard)  ── statische Assets + Auth-Routing (/.auth/*)
   │  /api/* (Linked Backend, injiziert x-ms-client-principal)
   ▼
Azure Function App  "func-mcopilot-<env>"  (Node.js, TypeScript, v4 Programming Model)
   ├─ HTTP-Funktionen (API)        ── validieren, Auth-Check, Cosmos lesen/schreiben, Job enqueuen
   └─ Queue-Funktion (Worker)      ── Audit-Pipeline
          │
          ├─► SafeFetcher ──► öffentliche Website
          ├─► HTML Analyzer (cheerio) ──► PageSnapshot
          ├─► Rules Engine ──► Findings (deterministisch)
          ├─► Scoring Engine ──► Scores (deterministisch, konfigurierbar)
          └─► AiProvider (Interface) ──► ClaudeProvider ──► Anthropic API
                                              │ API-Key
                                         Key Vault (Referenz)
   Persistenz: Cosmos DB (Managed Identity) · Queue: Storage Account (Managed Identity)
   Telemetrie: Application Insights (workspace-based)
```

### Komponenten im Detail (`apps/functions/src`)

| Modul                   | Verantwortung                                                                                   | Abhängigkeiten                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| `http/`                 | Trigger-Handler, Auth-Context, Request-Validierung (zod), Error-Mapping                         | `services/`, `shared-types`         |
| `auth/`                 | Parsen von `x-ms-client-principal`, Rollenprüfung                                               | –                                   |
| `services/auditService` | Audit anlegen, listen, lesen, löschen, Report zusammenstellen, Quoten                           | `AuditRepository`, `JobQueue`       |
| `worker/auditPipeline`  | Orchestrierung der Schritte 6–11 des Audit Flows, Statusübergänge, Idempotenz                   | alle Engines (injiziert)            |
| `fetcher/`              | `UrlValidator`, `SafeFetcher` (SSRF-Schutz)                                                     | Node `dns`, `undici`                |
| `analyzer/`             | HTML → `PageSnapshot` (Title, Meta, Headings, Links, Scripts, Forms-Metadaten, sichtbarer Text) | `cheerio`                           |
| `rules/`                | Rule-Registry, Rule-Implementierungen je Kategorie, Ruleset-Definition                          | nur `PageSnapshot` (pure functions) |
| `scoring/`              | deterministische Score-Berechnung                                                               | `ScoringConfig`                     |
| `ai/`                   | `AiProvider`-Interface, `ClaudeProvider`, Prompt-Builder, Output-Schema, Validierung            | Anthropic SDK                       |
| `persistence/`          | `AuditRepository` (Cosmos), `JobQueue` (Storage Queue)                                          | Azure SDKs                          |
| `config/`               | typisierte, validierte Konfiguration aus Umgebungsvariablen                                     | –                                   |
| `connectors/`           | **nur Platzhalter-README** (HubSpot, GA4, Dynamics, Customer Insights, GATE) – kein Code im MVP | –                                   |

Dependency Injection: manuelle Constructor-Injection über eine Composition Root (`src/container.ts`); kein DI-Framework. Alle I/O-Grenzen (Fetcher, Repository, Queue, AiProvider, Clock) sind Interfaces → in Tests ersetzbar. Die Test-Doubles liegen ausschließlich im `tests/`-Baum, nicht im Produktionspfad.

---

## 3. Datenfluss

**Anlegen (synchron, < 1 s):**

1. SPA → `POST /api/audits {url, modules}` (Cookie-Session der SWA).
2. SWA leitet an die Function App weiter und setzt `x-ms-client-principal`.
3. Function: Principal prüfen → Body per zod validieren → `UrlValidator` (Syntax, Schema, Port, Blocklist, optionale Domain-Allowlist) → Quote prüfen (max. aktive/Tages-Audits pro User).
4. Audit-Dokument `status=queued` in Cosmos schreiben, Nachricht `{auditId, ownerId, schemaVersion}` in Queue `audit-jobs`.
5. Antwort `202 Accepted` + `Location: /api/audits/{id}`.

**Verarbeiten (asynchron, Queue-Trigger):** 6. Dokument laden; wenn `status ∈ {completed, failed}` → Nachricht verwerfen (Idempotenz); sonst `status=running`, `attempts++`. 7. `SafeFetcher` ruft die URL ab (DNS-Auflösung → IP-Prüfung → Verbindung an die geprüfte IP, Redirects manuell, jeder Hop erneut validiert). 8. `HtmlAnalyzer` erzeugt `PageSnapshot`. 9. `RulesEngine.evaluate(snapshot, ruleset, modules)` → `Finding[]`. 10. `ScoringEngine.score(findings, config)` → `AuditScore`. 11. `AiProvider.assess(AiAssessmentInput)` → `AiAssessment` (Timeout, 1 Retry bei 429/5xx/ungültigem JSON; danach `ai.status=failed`). 12. Cosmos-Dokument aktualisieren (`status=completed`), Telemetrie schreiben. 13. Fataler Fehler (Fetch blockiert/fehlgeschlagen, Nicht-HTML) → `status=failed` mit `error.code`; **kein** Queue-Retry bei deterministischen Fehlern (Nachricht wird erfolgreich beendet). Nur transiente Infrastrukturfehler werfen → Queue-Retry → nach `maxDequeueCount=3` Poison Queue `audit-jobs-poison`.

**Anzeigen:** SPA pollt `GET /api/audits/{id}` alle 3 s (Backoff bis 10 s) bis `completed|failed`, dann `GET /api/audits/{id}/report`.

---

## 4. Security Boundaries

```
 [Internet/Browser] ──TLS──► [SWA: Auth-Gate, Route-Regeln]  ← Boundary 1: nur authentifizierte Entra-Benutzer
 [SWA] ──────────────────► [Function App]                     ← Boundary 2: nur SWA darf aufrufen, Principal wird erneut geprüft
 [Function App] ──MI/RBAC─► [Cosmos | Storage Queue | Key Vault] ← Boundary 3: keine Keys/Connection-Strings
 [Function App] ──────────► [Öffentliche Zielwebsite]         ← Boundary 4: SSRF-Schutz (SafeFetcher)
 [Function App] ──HTTPS───► [Anthropic API]                   ← Boundary 5: nur ausgewählte, öffentliche Inhalte; API-Key aus Key Vault
```

**B1 – Authentifizierung:** Microsoft Entra ID, Single-Tenant. `staticwebapp.config.json`: `/api/*` → `allowedRoles: ["authenticated"]`; nicht authentifiziert → 302 auf Login. Ausnahme: `GET /api/health` (anonym, nur Liveness).
**[ANNAHME]** Für Entra-ID-Login mit Tenant-Beschränkung wird in SWA ein _Custom OpenID Connect Provider_ (Standard-Plan) mit tenant-spezifischem Issuer (`https://login.microsoftonline.com/<tenantId>/v2.0`) konfiguriert; der Client-Secret der App-Registrierung liegt als SWA-App-Setting (nicht im Repo). Details gegen aktuelle SWA-Doku prüfen.

**B2 – Backend-Härtung:** Function App wird als _Linked Backend_ an die SWA gebunden. **[ANNAHME]** Das Linking konfiguriert die Function App so, dass sie nur Aufrufe über die SWA akzeptiert; unabhängig davon prüft jede HTTP-Funktion `x-ms-client-principal` (vorhanden, `identityProvider`, `userId`, Rolle `authenticated`) und nutzt `authLevel: anonymous` nur, weil das Gate davor liegt. Optional: Entra-Gruppen-/App-Role-Prüfung (`ALLOWED_ROLE`, leer = jeder Tenant-User).

**B3 – Secrets & Identität:** System-assigned Managed Identity der Function App erhält:

- Cosmos DB: _Cosmos DB Built-in Data Contributor_ (Data-Plane-RBAC, auf Container-/DB-Scope)
- Storage: _Storage Queue Data Contributor_ (+ _Storage Blob Data Owner_ für den Functions-Host, falls identitätsbasierter `AzureWebJobsStorage`)
- Key Vault: _Key Vault Secrets User_
  Das einzige echte Secret im System ist der **Anthropic-API-Key** (Key Vault; App-Setting als Key-Vault-Referenz) sowie der OIDC-Client-Secret der SWA. Kein Cosmos-Key, kein Storage-Key.

**B4 – SSRF-Schutz (`SafeFetcher`)** – siehe Abschnitt 4.1.

**B5 – Daten an Claude:** nur öffentlich abrufbarer Seiteninhalt (Titel, Headings, begrenzter sichtbarer Text) + Findings. Keine Formularwerte, keine Cookies, keine Header, keine Nutzerdaten. **Prompt-Injection:** Seitentext ist untrusted; er steht in klar abgegrenzten Datenblöcken, der System-Prompt weist an, ihn als Daten zu behandeln; Ausgabe wird per Schema validiert und kann Messwerte/Scores nicht verändern (Defense in Depth durch Architektur, nicht durch Prompt).

**Datenschutz:** Es werden nur Seiten-Metadaten gespeichert. Von Formularen: Anzahl, Methode, Feldtypen (`email`, `tel`, `text` …), Vorhandensein einer Consent-Checkbox – **nie** Werte oder `value`-Attribute. Gespeichert wird nur die Entra-`userId` (oid) als `ownerId`; kein Name/E-Mail im Audit. Audits haben TTL (Standard 90 Tage).

### 4.1 SSRF-Schutz (Spezifikation)

Prüfungen vor jeder Verbindung (initial **und** bei jedem Redirect-Hop):

| Kontrolle          | Regel                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema             | nur `http:` und `https:` (blockiert `file:`, `ftp:`, `gopher:`, `data:` …)                                                                                                                                                                                                                                                                  |
| Credentials in URL | `user:pass@` → abgelehnt                                                                                                                                                                                                                                                                                                                    |
| Port               | nur 80/443 (konfigurierbar)                                                                                                                                                                                                                                                                                                                 |
| Hostname           | Blocklist: `localhost`, `*.localhost`, `*.local`, `*.internal`, `metadata.google.internal`, einfache Hostnamen ohne Punkt                                                                                                                                                                                                                   |
| IP-Literale        | WHATWG-`URL` normalisiert Dezimal/Hex/Oktal-Formen; danach IP-Prüfung                                                                                                                                                                                                                                                                       |
| Aufgelöste IPs     | **alle** A/AAAA-Ergebnisse müssen öffentlich sein; blockiert: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16` (inkl. `169.254.169.254`), `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4`, `240/4`, IPv6 `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped (`::ffff:a.b.c.d` → v4-Regeln), `fd00:ec2::254` |
| DNS-Rebinding      | Verbindung erfolgt zur **geprüften IP** (custom `lookup`/`connect` im undici-Agent), nicht zu erneut aufgelöstem Namen; TLS-SNI/Host bleiben der Originalhost                                                                                                                                                                               |
| Redirects          | `redirect: manual`, max. 5 Hops (konfigurierbar), jeder `Location` wird neu validiert; Wechsel auf blockiertes Ziel → Abbruch                                                                                                                                                                                                               |
| Timeout            | Gesamtbudget 10 s (Connect + Header + Body), per `AbortSignal`                                                                                                                                                                                                                                                                              |
| Response-Größe     | max. 2 MB, **streamend** gezählt (kein Vertrauen auf `Content-Length`); Dekompression wird nach der Dekomprimierung begrenzt                                                                                                                                                                                                                |
| Content-Type       | nur `text/html`, `application/xhtml+xml`; sonst `UNSUPPORTED_CONTENT_TYPE`                                                                                                                                                                                                                                                                  |
| Allowlist          | optional `DOMAIN_ALLOWLIST` (exakte Domains + Subdomains); leer = alle öffentlichen Ziele                                                                                                                                                                                                                                                   |
| Funktions-Host     | Zusätzlich implizit blockiert: Loopback → schützt `IDENTITY_ENDPOINT`/`MSI_ENDPOINT` des Function-Hosts (Token-Diebstahl)                                                                                                                                                                                                                   |
| Fehlermeldungen    | generisch (`TARGET_BLOCKED`), keine Detailleaks über interne Netze                                                                                                                                                                                                                                                                          |
| User-Agent         | `MarketingCopilotAuditor/1.0 (+intern)`; keine Cookies, kein JS, kein Login                                                                                                                                                                                                                                                                 |

Zwingende Unit-Tests in `tests/crawler/`: alle Blocklist-Kategorien, IPv6/mapped/Dezimal-/Hex-Notation, Redirect auf `127.0.0.1`/`169.254.169.254`, Redirect-Limit, Größen-/Timeout-Abbruch, Content-Type.

---

## 5. Datenmodell

Cosmos DB for NoSQL, **Serverless**, Datenbank `marketingcopilot`.

### Container `audits` – Partition Key `/ownerId`, TTL aktiviert (`ttl` pro Dokument)

[ENTSCHEIDUNG] Ein Dokument pro Audit (Report eingebettet): ein Point-Read liefert alles, Größe weit unter dem 2-MB-Limit (Texte sind gekappt). `ownerId` als Partition Key → `GET /audits` ist eine Single-Partition-Query; Benutzer sehen im MVP **nur eigene** Audits.

```ts
interface AuditDocument {
  id: string; // auditId (UUID v4)
  ownerId: string; // Entra userId (oid)  — Partition Key
  type: "audit";
  schemaVersion: 1;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string; // ISO-8601 UTC
  attempts: number;
  ttl: number; // Sekunden

  input: {
    url: string; // vom Benutzer eingegeben
    normalizedUrl: string;
    modules: AuditCategory[]; // subset von seo|tracking|consent|content|conversion
    rulesetId: string;
    rulesetVersion: string;
  };

  fetch?: {
    finalUrl: string;
    redirectChain: string[];
    statusCode: number;
    contentType: string;
    bytes: number;
    durationMs: number;
    fetchedAt: string;
  };

  page?: {
    // gekappter, öffentlicher Seiteninhalt
    title: string | null;
    metaDescription: string | null;
    canonical: string | null;
    lang: string | null;
    headings: { level: 1 | 2 | 3 | 4 | 5 | 6; text: string }[]; // max 60, Text ≤ 200 Zeichen
    visibleTextExcerpt: string; // ≤ 6000 Zeichen
    wordCount: number;
  };

  findings?: TechnicalFinding[];
  score?: AuditScore;
  ai?: AiAssessmentRecord;
  error?: { code: AuditErrorCode; message: string };
}

type AuditCategory = "seo" | "tracking" | "consent" | "content" | "conversion";

interface TechnicalFinding {
  ruleId: string; // z. B. "SEO_META_DESCRIPTION"
  category: AuditCategory;
  status: "passed" | "failed" | "warning" | "not_applicable";
  severity: "critical" | "high" | "medium" | "low" | "info";
  evidence: Record<string, string | number | boolean | null | string[]>;
  message: string; // deterministischer Text aus der Rule (de)
  source: "measured"; // fix – Abgrenzung zu KI
}

interface AuditScore {
  overall: number | null; // 0–100, gerundet
  categories: Partial<Record<AuditCategory, number | null>>;
  weightsApplied: Partial<Record<AuditCategory, number>>; // renormalisiert auf gewählte Module
  configVersion: string;
}

interface AiAssessmentRecord {
  status: "completed" | "failed" | "skipped";
  provider: "anthropic";
  model: string;
  promptVersion: string;
  generatedAt?: string;
  usage?: { inputTokens: number; outputTokens: number };
  result?: AiAssessment;
  error?: { code: string; message: string };
  source: "ai"; // fix
}

interface AiAssessment {
  executiveSummary: string;
  marketingFindings: {
    category: "seo" | "tracking" | "consent" | "content" | "conversion" | "messaging";
    severity: "high" | "medium" | "low";
    finding: string;
    recommendation: string;
    confidence: "high" | "medium" | "low";
  }[];
  priorities: {
    priority: number;
    action: string;
    ownerType: "marketing" | "content" | "web_dev" | "legal_privacy" | "analytics";
  }[];
  limitations: string[];
}
```

Bewusste Abweichung: KI-`severity` ist 3-stufig (`high|medium|low`) und kennt **kein** `critical` – "Critical" ist ausschließlich gemessenen Findings vorbehalten.

### Konfiguration (kein Cosmos im MVP)

Ruleset (`rulesets/default.v1.json`) und Scoring-Konfiguration (`scoring/default.v1.json`) liegen versioniert im Code; Gewichte lassen sich per `SCORING_CONFIG_JSON` (App Setting) überschreiben. **[ENTSCHEIDUNG]** Eine Cosmos-Konfigurationsverwaltung ist für den MVP unnötig; `GET /api/rulesets` liefert Katalog + aktive Gewichte.

### Queue-Nachricht (`audit-jobs`)

`{ "schemaVersion": 1, "auditId": "…", "ownerId": "…" }` – keine URL, keine Inhalte (Quelle der Wahrheit ist Cosmos).

### Scoring (deterministisch)

- Regelgewicht nach Severity: `critical=10, high=6, medium=3, low=1, info=0` (konfigurierbar).
- Je Regel Erfüllungsgrad: `passed=1`, `warning=0.5`, `failed=0`, `not_applicable` → ausgeschlossen.
- Kategorie-Score = `100 × Σ(Gewicht × Erfüllungsgrad) / Σ(Gewicht)` über anwendbare Regeln; keine anwendbaren Regeln → `null`.
- Gesamt-Score = gewichteter Mittelwert der Kategorie-Scores, Gewichte auf **gewählte** Module renormalisiert (Start: SEO 25, Tracking 25, Consent 20, Content 15, Conversion 15).
- **Consent** wird im UI als "Indikatoren" gekennzeichnet, weil nur statische Analyse möglich ist (kein Rechtsurteil).

---

## 6. API Contract

Basis `/api`, JSON, UTF-8. Auth: SWA-Session; alle Endpoints außer `health` erfordern `authenticated`. Fehlerformat (RFC-7807-angelehnt):
`{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [...] , "correlationId": "…" } }`

| Methode | Pfad                                | Beschreibung                                                                                            | Erfolg                                                                                                                 | Fehler                                                                     |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| POST    | `/audits`                           | Audit anlegen                                                                                           | `202` + `Location`, Body `{id, status:"queued"}`                                                                       | `400 VALIDATION_ERROR`, `400 URL_NOT_ALLOWED`, `401`, `429 QUOTA_EXCEEDED` |
| GET     | `/audits?limit=&continuationToken=` | Eigene Audits, neueste zuerst (Summary)                                                                 | `200 {items:[{id,url,status,createdAt,overallScore}], continuationToken?}`                                             | `401`                                                                      |
| GET     | `/audits/{auditId}`                 | Status + Metadaten (+ `error`)                                                                          | `200 AuditStatusDto`                                                                                                   | `404`, `401`                                                               |
| GET     | `/audits/{auditId}/report`          | Vollständiger Report                                                                                    | `200 AuditReportDto`                                                                                                   | `404`, `409 AUDIT_NOT_READY`                                               |
| DELETE  | `/audits/{auditId}`                 | Hard-Delete                                                                                             | `204`                                                                                                                  | `404`                                                                      |
| GET     | `/rulesets`                         | Regelkatalog + aktive Scoring-Gewichte                                                                  | `200 {rulesets:[{id,version,rules:[{ruleId,category,severity,title,description}],scoring:{weights,severityWeights}}]}` | `401`                                                                      |
| GET     | `/health`                           | anonym: Liveness `{status:"ok",version}`; `?deep=true` (authentifiziert): Cosmos/Queue/Key-Vault-Checks | `200`                                                                                                                  | `503`                                                                      |

Request `POST /audits`:

```json
{
  "url": "https://example.com/landing",
  "modules": ["seo", "tracking", "consent", "content", "conversion"]
}
```

Validierung: `url` ≤ 2048 Zeichen, `modules` nicht leer, Duplikate entfernt, nur bekannte Werte. Fremde Audit-IDs liefern `404` (kein `403`, kein Existenz-Leak).

`AuditReportDto` (Zusammensetzung): `{ audit: {id,url,finalUrl,status,createdAt,completedAt}, score, criticalIssues: TechnicalFinding[], technical: { findings: TechnicalFinding[] }, ai: AiAssessmentRecord, recommendedActions: AiAssessment.priorities }`.
`criticalIssues` wird **deterministisch** aus `findings` (`status=failed ∧ severity ∈ {critical, high}`) abgeleitet, nicht von der KI.

UI-Severity-Mapping: `failed ∧ (critical|high)` → rot "Critical"; `failed ∧ (medium|low)` oder `warning` → gelb/orange "Warning"; `passed` → grün; `not_applicable`/`info` → grau.

Gemeinsame Typen und zod-Schemas für DTOs liegen in `packages/shared-types` und werden von Frontend und Backend importiert.

---

## 7. Repository-Struktur

```
marketing-copilot/                      (= dieses Repo)
├─ apps/
│  ├─ web/                              React + Vite + TypeScript + Tailwind
│  │  ├─ src/{pages,components,api,auth,lib}
│  │  └─ staticwebapp.config.json
│  └─ functions/                        Azure Functions v4, Node.js, TypeScript
│     ├─ src/
│     │  ├─ http/  auth/  services/  worker/
│     │  ├─ fetcher/  analyzer/  rules/  scoring/  ai/
│     │  ├─ persistence/  config/  connectors/  (README only)
│     │  ├─ container.ts  index.ts
│     ├─ host.json  local.settings.sample.json
├─ packages/
│  └─ shared-types/                     DTOs, Enums, zod-Schemas
├─ infrastructure/
│  ├─ main.bicep
│  ├─ modules/{monitoring,storage,cosmos,keyvault,functionapp,staticwebapp,rbac}.bicep
│  └─ parameters/{dev,prod}.bicepparam
├─ tests/
│  ├─ rules/  crawler/  integration/    (Vitest; HTML-Fixtures unter tests/fixtures)
├─ docs/{ARCHITECTURE.md, adr/, runbook.md}
├─ .github/workflows/{ci.yml, deploy-dev.yml, deploy-prod.yml}
├─ package.json  (npm workspaces)   tsconfig.base.json (strict)   eslint/prettier
```

Tooling **[ENTSCHEIDUNG]**: npm workspaces (kein pnpm/Nx), Vitest, ESLint + Prettier, Vite, Node 20 LTS **[ANNAHME: aktuell unterstützte Functions-Runtime vor Umsetzung prüfen, ggf. Node 22]**. TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

---

## 8. Azure-Ressourcen

Je Umgebung eine eigene Resource Group (`rg-mcopilot-dev`, `rg-mcopilot-prod`), idealerweise getrennte Subscriptions.

| Ressource                            | SKU / Konfiguration                                                                                                                                                                                                                                    | Zweck                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Log Analytics Workspace              | PerGB2018, Retention dev 30 / prod 90 Tage                                                                                                                                                                                                             | Basis für App Insights                                          |
| Application Insights                 | workspace-based                                                                                                                                                                                                                                        | Logs, Traces, Metriken, Alerts                                  |
| Storage Account (Funktionen + Queue) | StorageV2, LRS (dev) / ZRS (prod), TLS 1.2, kein Public Blob Access, Shared-Key deaktiviert **[ANNAHME: abhängig vom Hosting-Plan]**                                                                                                                   | `AzureWebJobsStorage`, Queues `audit-jobs`, `audit-jobs-poison` |
| Cosmos DB Account                    | NoSQL, **Serverless**, Session-Konsistenz, lokale Auth deaktiviert, Public Network an (MVP)                                                                                                                                                            | Container `audits`                                              |
| Key Vault                            | Standard, RBAC-Modus, Soft Delete + Purge Protection                                                                                                                                                                                                   | `anthropic-api-key`                                             |
| Function App                         | Linux, Node, System-assigned MI; Plan **Flex Consumption (FC1)** – identitätsbasierter Storage-Zugriff ohne Account-Keys **[ANNAHME: SWA-Linked-Backend-Kompatibilität mit Flex Consumption vor dem ersten Deploy prüfen; Fallback: Elastic Premium]** | API + Worker in einer App                                       |
| Static Web App                       | **Standard** (nötig für Custom OIDC + Linked Backend) **[ANNAHME]**                                                                                                                                                                                    | Frontend, Auth-Gate, API-Proxy                                  |
| Role Assignments                     | siehe B3                                                                                                                                                                                                                                               | Managed Identity                                                |
| Alerts (prod)                        | Poison-Queue-Länge > 0, Failure-Rate Audits, Function-Exceptions                                                                                                                                                                                       | Betrieb                                                         |

Nicht per Bicep: **Entra-App-Registrierung** (manuell/Skript, dokumentiert im Runbook) und der **Wert** des Anthropic-API-Keys (wird manuell in den Key Vault gesetzt, Bicep legt nur das Secret-Gefäß/Zugriff an).

Deployment: GitHub Actions mit **OIDC-Federated-Credential** (kein Service-Principal-Secret). `main` → DEV automatisch; PROD per GitHub-Environment mit manueller Freigabe. Bicep-`what-if` im PR.

---

## 9. Konfigurationsparameter

Alle als App Settings der Function App (typisiert + beim Start validiert; fehlende Pflichtwerte → Start schlägt fehl).

| Name                                                              | Pflicht | Default            | Beschreibung                                                                                    |
| ----------------------------------------------------------------- | ------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `COSMOS_ENDPOINT`                                                 | ja      | –                  | Endpoint (MI-Auth)                                                                              |
| `COSMOS_DATABASE`                                                 | nein    | `marketingcopilot` |                                                                                                 |
| `STORAGE_QUEUE_ACCOUNT_NAME` / `AzureWebJobsStorage__accountName` | ja      | –                  | identitätsbasierte Verbindung                                                                   |
| `AUDIT_QUEUE_NAME`                                                | nein    | `audit-jobs`       |                                                                                                 |
| `ANTHROPIC_API_KEY`                                               | ja      | –                  | **Key-Vault-Referenz**, nie Klartext                                                            |
| `AI_MODEL`                                                        | ja      | –                  | Claude-Modell-ID (bewusst kein hartes Default; vor Umsetzung gegen aktuelle Modellliste setzen) |
| `AI_TIMEOUT_MS` / `AI_MAX_OUTPUT_TOKENS`                          | nein    | 60000 / 4096       |                                                                                                 |
| `AI_ENABLED`                                                      | nein    | `true`             | `false` → `ai.status="skipped"` (kein Mock-Output)                                              |
| `FETCH_TIMEOUT_MS`                                                | nein    | 10000              |                                                                                                 |
| `FETCH_MAX_BYTES`                                                 | nein    | 2097152            |                                                                                                 |
| `FETCH_MAX_REDIRECTS`                                             | nein    | 5                  |                                                                                                 |
| `FETCH_ALLOWED_PORTS`                                             | nein    | `80,443`           |                                                                                                 |
| `DOMAIN_ALLOWLIST`                                                | nein    | leer               | kommagetrennt; leer = aus                                                                       |
| `SCORING_CONFIG_JSON`                                             | nein    | Code-Default       | Gewichtungs-Override                                                                            |
| `AUDIT_TTL_DAYS`                                                  | nein    | 90                 |                                                                                                 |
| `MAX_ACTIVE_AUDITS_PER_USER` / `MAX_AUDITS_PER_USER_PER_DAY`      | nein    | 3 / 50             | Kosten-/Missbrauchsschutz                                                                       |
| `ALLOWED_ROLE`                                                    | nein    | leer               | optionale zusätzliche Rollenprüfung                                                             |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`                           | ja      | –                  |                                                                                                 |
| `LOG_LEVEL`                                                       | nein    | `info`             |                                                                                                 |

SWA: `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET` (App Settings, via Pipeline gesetzt), Tenant-ID im OIDC-Issuer.

---

## 10. Implementierungsreihenfolge

| #   | Inkrement                                                                                                                               | Ergebnis / Abnahme                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0   | Monorepo-Gerüst: workspaces, strict-tsconfig, ESLint/Prettier, Vitest, CI (lint/typecheck/test)                                         | CI grün                                            |
| 1   | `shared-types`: Enums, DTOs, zod-Schemas                                                                                                | Typen von beiden Apps importierbar                 |
| 2   | `analyzer` + `rules` + Ruleset v1 (SEO, Tracking, Consent, Content, Conversion) + Unit-Tests mit HTML-Fixtures                          | Rules Engine vollständig getestet (rein, ohne I/O) |
| 3   | `scoring` + Tests (Gewichtung, Renormalisierung, `null`-Fälle)                                                                          | deterministisch, konfigurierbar                    |
| 4   | `UrlValidator` + `SafeFetcher` + Crawler-Tests (SSRF-Matrix)                                                                            | Sicherheitsabnahme vor allem Weiteren              |
| 5   | `config`, `persistence` (Cosmos-Repository, Queue), `auth`, HTTP-Endpoints, Quoten                                                      | API lokal gegen Azurite + Cosmos-Emulator          |
| 6   | Worker-Pipeline (ohne KI), Statusübergänge, Idempotenz, Poison-Handling                                                                 | Ende-zu-Ende mit technischem Report                |
| 7   | `AiProvider` + `ClaudeProvider` (Tool-Use mit JSON-Schema, Validierung, Retry, Injection-Hygiene) + Tests mit aufgezeichneten Antworten | Marketing-Bewertung getrennt gespeichert           |
| 8   | Frontend: Auth-Flow, Startseite, Polling, Result Page (technisch/KI visuell getrennt), Audit-Liste                                      | UI-Abnahme                                         |
| 9   | Bicep-Module, `dev`/`prod`-Parameter, RBAC, Alerts                                                                                      | `what-if` + DEV-Deploy                             |
| 10  | Deploy-Pipelines (OIDC), Entra-Setup-Runbook, SWA-Auth-Konfiguration                                                                    | DEV live, PROD-Gate                                |
| 11  | Hardening: Integrationstests, Lasttest-Smoke, Datenschutz-Review, Runbook                                                               | MVP-Abnahme                                        |

Lokale Entwicklung: Azurite (Queue), Cosmos-DB-Emulator, SWA CLI (`swa start` mit Auth-Emulation), Functions Core Tools.

---

## 11. Entscheidungen (ADR-Kurzform) & bekannte Einschränkungen

| #   | Entscheidung                                                                   | Begründung / Konsequenz                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Ein** Function App für API und Worker                                        | einfachste Lösung; SWA-_Managed_ Functions unterstützen nur HTTP-Trigger → Linked Backend nötig (**[ANNAHME]**)                                                                                                                                                                          |
| D2  | **Statisches HTML**, kein Headless-Browser                                     | einfach, sicher, billig. Einschränkung: per JS nachgeladene Skripte/Consent-Banner und Tracking nach Interaktion werden nicht erkannt. Befunde heißen "im initialen HTML erkannt". Browser-Rendering = spätere Ausbaustufe                                                               |
| D3  | Polling statt SignalR/WebSockets                                               | MVP-Einfachheit                                                                                                                                                                                                                                                                          |
| D4  | Ein Cosmos-Dokument pro Audit, PK `/ownerId`, nur eigene Audits sichtbar       | schnelle Point-Reads; team-weite Sicht = spätere Erweiterung (z. B. zweiter Container/Index)                                                                                                                                                                                             |
| D5  | Managed Identity statt Keys für Cosmos/Storage                                 | nur ein Secret (Anthropic-Key) im Key Vault                                                                                                                                                                                                                                              |
| D6  | Claude per **Tool-Use mit erzwungenem JSON-Schema** + zod-Validierung, 1 Retry | **[ANNAHME]** Anthropic-Messages-API unterstützt `tools` mit `input_schema` und `tool_choice`; vor Umsetzung gegen aktuelle Anthropic-Doku prüfen. Direkter Anthropic-Endpunkt (ausgehend HTTPS); Alternative Claude über Microsoft Foundry ist über das Provider-Interface austauschbar |
| D7  | Rules sind reine Funktionen auf `PageSnapshot`                                 | triviale Testbarkeit, deterministisch, versioniertes Ruleset                                                                                                                                                                                                                             |
| D8  | Deterministische Fehler beenden die Queue-Nachricht (kein Retry)               | vermeidet Poison-Müll; nur transiente Fehler → Retry                                                                                                                                                                                                                                     |
| D9  | Consent-Modul = Indikatoren, keine Rechtsberatung                              | UI-Hinweistext, Score als "Indicator Score"                                                                                                                                                                                                                                              |
| D10 | Kein robots.txt-Handling im MVP                                                | internes Tool, einzelne Seitenabrufe; klarer User-Agent. Bei Bedarf nachrüsten                                                                                                                                                                                                           |
| D11 | `connectors/` nur als dokumentierter Platzhalter                               | kein toter Code; Interface wird mit dem ersten echten Connector eingeführt                                                                                                                                                                                                               |
| D12 | Nur eine URL pro Audit (kein Site-Crawl)                                       | Scope; Architektur erlaubt später mehrere Pages je Audit                                                                                                                                                                                                                                 |

### Offene Verifikationspunkte vor Implementierung (alle als [ANNAHME] oben markiert)

1. SWA Standard + Custom-OIDC-Provider für tenant-beschränktes Entra-Login (und Speicherung des Client-Secrets).
2. SWA Linked Backend: unterstützte Function-App-Pläne (Consumption vs. Flex) und tatsächliche Zugriffsbeschränkung.
3. Identitätsbasierter `AzureWebJobsStorage` auf dem gewählten Plan.
4. Aktuelle Node-Runtime-Version für Azure Functions v4.
5. Aktuelle Claude-Modell-ID und Tool-Use-/Structured-Output-Parameter.
