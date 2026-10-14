# Runbook – Einrichtung DEV/PROD

Stand: Inkrement 9. Die Pipelines (Inkrement 10) automatisieren die Schritte 4–6. Alles hier ist **ungetestet gegen eine echte Azure-Subscription** – das Bicep-Template wurde nur lokal übersetzt und typgeprüft (`bicep build`, `bicep lint`).

## 0. Voraussetzungen

- Azure-Subscription, je Umgebung eine Resource Group (`rg-mcopilot-dev`, `rg-mcopilot-prod`), idealerweise getrennte Subscriptions.
- Der Deployment-Benutzer/-Service-Principal braucht auf der Resource Group **Contributor** und zusätzlich **Role Based Access Control Administrator** (oder User Access Administrator), weil das Template Rollenzuweisungen anlegt.
- Azure CLI (`az`) mit Bicep.

## 1. Entra-App-Registrierung (manuell, je Umgebung)

[ANNAHME] Vorgehen für Custom-OIDC in Static Web Apps; gegen die aktuelle SWA-Doku prüfen.

1. Entra ID → App-Registrierungen → Neu. _Nur dieses Verzeichnis_ (Single Tenant).
2. Redirect-URI (Web): `https://<swa-hostname>/.auth/login/aad/callback` (Hostname = Ausgabe `staticWebAppHostname` nach dem ersten Deploy; dann URI nachtragen).
3. Zertifikate & Geheimnisse → neues Client-Secret. **Nicht ins Repository.**
4. Notiere Client-ID und Tenant-ID.
5. Empfohlen: Enterprise-Anwendung → _Zuweisung erforderlich_ = Ja, und nur die berechtigte Marketing-Gruppe zuweisen. Ohne das kann jeder Benutzer des Tenants den Dienst nutzen.
6. In `apps/web/staticwebapp.config.json` den Platzhalter `__TENANT_ID__` ersetzen (macht die Pipeline in Inkrement 10 beim Deploy; lokal nie committen).

## 2. Infrastruktur deployen

```
az group create -n rg-mcopilot-dev -l westeurope
export AAD_CLIENT_SECRET='<client-secret>'      # nur in der Shell, nie im Repo
az deployment group what-if -g rg-mcopilot-dev -f infrastructure/main.bicep -p infrastructure/parameters/dev.bicepparam
az deployment group create  -g rg-mcopilot-dev -f infrastructure/main.bicep -p infrastructure/parameters/dev.bicepparam
```

Vorher in `parameters/<env>.bicepparam` die `aadClientId` eintragen.

## 3. Anthropic-API-Key im Key Vault ablegen

Das Template legt Key Vault und Zugriff (RBAC, Rolle _Key Vault Secrets User_ für die Function-App-Identität) an, aber **nicht** den Secret-Wert.

```
az role assignment create --assignee <dein-user> --role "Key Vault Secrets Officer" --scope <key-vault-id>
az keyvault secret set --vault-name <kv-name> --name anthropic-api-key --value '<key>'
```

Danach in der `.bicepparam` `aiEnabled = true` und `aiModel = '<modell-id>'` setzen und neu deployen. Solange `aiEnabled = false`, erscheint im Report „KI-Bewertung deaktiviert“.

## 4. Anwendung deployen (wird in Inkrement 10 automatisiert)

- Function App (Flex Consumption): Build (`npm ci && npm run build -w @mcopilot/functions`), Paket per `az functionapp deployment source config-zip` oder Azure Functions Core Tools. Der Deployer braucht Schreibrechte auf den Container `app-package` (_Storage Blob Data Contributor_).
- Static Web App: `swa deploy` mit Deployment-Token (`az staticwebapp secrets list`).

## 5. Verifikation nach dem Deploy

1. `GET https://<swa>/api/health` → `{"status":"ok"}` (anonym).
2. Anmelden, dann `GET /api/health?deep=true` → Cosmos und Queue `ok`.
3. Test-Audit auf eine öffentliche URL; Verlauf und Report prüfen.
4. Poison-Queue und Alarme (PROD) prüfen.

## 6. Offene Annahmen (vor erstem Deploy klären)

| #   | Annahme                                                                                     | Prüfen                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Flex Consumption (FC1) kann als SWA-Linked-Backend dienen                                   | SWA-Doku "Bring your own functions"; sonst Plan in `modules/functionapp.bicep` auf Elastic Premium ändern                |
| 2   | Linked Backend sperrt direkte Aufrufe der Function App                                      | Direktaufruf `https://func-…azurewebsites.net/api/audits` ohne SWA muss scheitern; sonst IP-/Auth-Einschränkung ergänzen |
| 3   | Custom-OIDC mit Entra-Tenant-Issuer funktioniert wie konfiguriert                           | Login testen                                                                                                             |
| 4   | Key-Vault-Referenz (`@Microsoft.KeyVault(SecretUri=…)`) wird auf Flex Consumption aufgelöst | In der Function App Konfiguration: Status „Resolved“                                                                     |
| 5   | Queue-Trigger mit identitätsbasierter Verbindung (`AzureWebJobsStorage__accountName`)       | Test-Audit läuft durch                                                                                                   |
| 6   | Node-Version 22 auf Flex Consumption verfügbar                                              | `functionNodeVersion` ggf. auf `20`                                                                                      |
