# Connectors

Jeder Connector ist ein schmales Interface (`client.ts`) plus genau einer Implementierung mit
echtem Netzwerkzugriff (`httpClient.ts`). Tests laufen ausschließlich gegen ein Test-Double.

| Connector                    | Status                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `googleBusinessProfile/`     | implementiert (Reviews-Modul, Inkrement R1) — nie gegen ein echtes Google-Konto geprüft |
| HubSpot                      | Platzhalter — kein Code                                                                 |
| GA4                          | Platzhalter — kein Code                                                                 |
| Dynamics / Customer Insights | Platzhalter — kein Code                                                                 |

Siehe `docs/ARCHITECTURE.md` (Abschnitt "Nachtrag: Modul Reviews") und `docs/known-gaps.md`.
