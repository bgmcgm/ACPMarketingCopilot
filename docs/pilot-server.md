# Pilotbetrieb auf einem eigenen Server (ohne Azure)

Für einen kleinen, internen Test mit mehreren Personen, bevor es eine Azure-Umgebung gibt. **Kein Ersatz für den Produktivbetrieb.** Getestet ist nur der Start und die Anmeldung auf einem lokalen Linux-Rechner; auf einem echten Server oder unter Windows Server wurde es nicht ausprobiert.

## Was du dafür bekommst – und was nicht

| Ja                                                                                               | Nein                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Alle sehen dieselbe Oberfläche und nutzen echte Abrufe, Regeln, Score (und KI, wenn Key gesetzt) | Kein Firmen-Login (Entra ID): Es gibt **ein gemeinsames Passwort**                    |
| Jede Person hat einen eigenen Benutzernamen und sieht nur ihre eigenen Audits                    | Der Benutzername wird nicht geprüft – wer das Passwort kennt, kann jeden Namen wählen |
| Anmeldung ist Pflicht (ohne Passwort startet der Server im Netz gar nicht)                       | Daten nur im Arbeitsspeicher: Neustart = alles weg, nur eine Instanz                  |
| Schutz vor Abrufen interner Adressen (SSRF) wie im Produktivsystem                               | Keine Verschlüsselung durch uns: **HTTPS muss ein Reverse-Proxy der IT liefern**      |

Das Passwort und das Sitzungs-Cookie werden bei HTTP im Klartext übertragen. Betreibe den Server deshalb nur in einem internen Netz und idealerweise hinter HTTPS. Nicht ins Internet stellen. Gib keine vertraulichen oder personenbezogenen Seiten in Audits ein; die Tests mit echten Daten gehören in die Azure-Umgebung mit Entra-Login.

## Offener Test ohne Passwort (nur vertrauenswürdiges Netz)

Für einen schnellen Test im eigenen Heim- oder Labornetz geht es auch ohne Anmeldung. In `~/mcopilot.env` statt `DEMO_PASSWORD` diese Zeile setzen:

```
DEMO_ALLOW_OPEN=yes
```

Folgen: Jeder, der die Adresse im Netz erreicht, kann Audits auslösen; alle sehen **dieselben** Audits (ein gemeinsamer Benutzer, gemeinsames Limit von 3 gleichzeitigen und 200 Audits pro Tag). Die **KI-Bewertung ist in diesem Modus immer aus**, damit niemand auf Kosten deines API-Keys Audits auslöst. Der Schutz vor Abrufen interner Adressen (SSRF) bleibt aktiv. Nicht ins Internet stellen, keine Portweiterleitung am Router.

## Linux-Server ohne Administratorrechte

Alles im eigenen Benutzerverzeichnis, ohne `sudo`:

```
# 1. Node 22 ohne Installation (Version von https://nodejs.org/dist/ nehmen)
cd ~ && curl -O https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz
tar xf node-v22.22.0-linux-x64.tar.xz
export PATH=$HOME/node-v22.22.0-linux-x64/bin:$PATH      # dauerhaft: in ~/.bashrc eintragen
node -v

# 2. Code holen und bauen
git clone https://github.com/bgmcgm/ACPMarketingCopilot && cd ACPMarketingCopilot
git checkout claude/modest-knuth-y13bf0
npm ci
npm run build

# 3. Zugangsdaten in eine Datei, nur für dich lesbar
cat > ~/mcopilot.env <<'ENV'
DEMO_HOST=0.0.0.0
DEMO_PORT=7071
DEMO_PASSWORD=<mindestens-12-Zeichen-zufällig>
# optional, nur wenn die KI laufen soll:
# AI_MODEL=<modell-id>
# ANTHROPIC_API_KEY=<key>
ENV
chmod 600 ~/mcopilot.env

# 4. Starten (läuft nach dem Abmelden weiter)
set -a; . ~/mcopilot.env; set +a
nohup node apps/functions/dist/dev/demoServer.js > ~/mcopilot.log 2>&1 &
```

Erreichbar unter `http://<server-name>:7071`. Dafür muss der Port in der Firewall für das interne Netz freigegeben sein (Sache der IT). Soll der Dienst nach einem Server-Neustart wieder anlaufen, braucht es einen Dienst-Eintrag (z. B. systemd-User-Service oder die Aufgabenplanung der IT).

## Windows-Server

Gleiches Prinzip: Node als **ZIP** von nodejs.org entpacken (ohne Installer), in PowerShell `$env:Path = "…\node-v22…-win-x64;" + $env:Path`, dann `git clone`, `npm.cmd ci`, `npm.cmd run build`. Variablen setzen und starten:

```
$env:DEMO_HOST="0.0.0.0"; $env:DEMO_PASSWORD="<mindestens-12-Zeichen>"
node apps\functions\dist\dev\demoServer.js
```

Dauerbetrieb und Firewall-Freigabe richtet die IT ein (Aufgabenplanung oder Dienst).

## Aktualisieren

```
cd ~/ACPMarketingCopilot && git pull && npm ci && npm run build
# Server beenden (Prozess finden mit: ps -u $USER | grep node) und wie oben neu starten
```

## So melden sich Teilnehmende an

1. Adresse im Browser öffnen, zum Beispiel `http://<server>:7071`.
2. Auf der Anmeldeseite einen **Namen** (frei wählbar, zum Beispiel der Vorname) und das **gemeinsame Passwort** eintippen.
3. Oben rechts „Abmelden“ beendet die Sitzung. Skripte können alternativ HTTP Basic nutzen (`curl -u name:passwort …`).

## Teilnehmende einweisen

- Adresse und Passwort bekommen sie getrennt (nicht in dieselbe Nachricht).
- Benutzername = z. B. Vorname; jede Person bleibt bei ihrem Namen.
- Es gelten Limits: höchstens 3 gleichzeitige Audits und 200 pro Tag und Benutzername.
- Ergebnisse sind nach einem Neustart weg.
- Jede eingegebene URL wird vom Server aus abgerufen und der Seitentext ggf. an die KI gesendet.
