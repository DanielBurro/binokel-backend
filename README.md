# Binokel Multiplayer App

Netzwerkfähige Mehrspieler-Anwendung für das Kartenspiel Binokel (Studienarbeit an der DHBW).

## Projektstruktur

- `backend/`: Server-Logik und Regel-Engine
- `frontend/`: Mobiler Client (Cross-Platform)

## Entwicklung

Voraussetzung: Node.js ≥ 22.22.1 (siehe `.nvmrc`).

### Schnellstart

```bash
npm ci              # Abhängigkeiten installieren und Git-Hooks einrichten
npm run dev         # Server mit Hot-Reload starten (Port 3000)
npm test            # Tests ausführen
npm run lint        # ESLint ausführen
npm run format      # Code mit Prettier formatieren
```

### Verfügbare NPM-Befehle

| Befehl                        | Beschreibung                                                                                     |
| :---------------------------- | :----------------------------------------------------------------------------------------------- |
| **`npm ci`**                  | Abhängigkeiten exakt installieren und Git-Hooks via Husky einrichten                             |
| **`npm run dev`**             | Entwicklungsserver mit Hot-Reload starten (`tsx watch src/index.ts`)                             |
| **`npm run build`**           | TypeScript-Code kompilieren (`tsc`)                                                              |
| **`npm start`**               | Kompiliertes Backend starten (`node dist/index.js`)                                              |
| **`npm test`**                | Vitest-Tests einmalig ausführen (`vitest run`)                                                   |
| **`npm run test:watch`**      | Tests im interaktiven Watch-Modus starten (`vitest`)                                             |
| **`npm run test:coverage`**   | Tests mit V8-Coverage-Bericht ausführen (`vitest run --coverage`)                                |
| **`npm run lint`**            | Statische Code-Analyse mit ESLint durchführen (`eslint src/`)                                    |
| **`npm run lint:fix`**        | Behebbare ESLint-Fehler automatisch korrigieren (`eslint src/ --fix`)                            |
| **`npm run format`**          | Code mit Prettier automatisch formatieren (`prettier --write .`)                                 |
| **`npm run format:check`**    | Formatierung aller Dateien mit Prettier prüfen (`prettier --check .`)                            |
| **`npm run protocol:export`** | Protokoll-Schemas als JSON Schema für das Frontend exportieren (`protocol/protocol.schema.json`) |

Optionale Umgebungsvariablen: `PORT`, `CORS_ORIGIN` (kommaseparierte Origins), `RECONNECT_GRACE_MS`, `ROOM_TTL_MS`.

## Git Commit-Konventionen

Alle Commit-Nachrichten folgen der Spezifikation der [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(optional scope): <description>
```

| Typ            | Bedeutung       | Beschreibung                                                               |
| :------------- | :-------------- | :------------------------------------------------------------------------- |
| **`feat`**     | Feature         | Neue Funktion oder Spiellogik für Nutzer/System                            |
| **`fix`**      | Bugfix          | Behebung eines Fehlers im Code                                             |
| **`chore`**    | Routine/Wartung | Build-Konfigurationen, Dependencies, Hilfsskripte (kein Produktivcode)     |
| **`refactor`** | Refactoring     | Code-Umstrukturierung ohne funktionale Änderung oder Bugfix                |
| **`test`**     | Tests           | Hinzufügen, Korrigieren oder Anpassen von Unit-/Integrationstests          |
| **`docs`**     | Dokumentation   | Änderungen an Dokumentationen, Spezifikationen oder README                 |
| **`style`**    | Formatierung    | Rein optische Anpassungen (Leerzeichen, Semikolons, Einrückungen)          |
| **`perf`**     | Performance     | Optimierung von Algorithmen, Laufzeit oder Speicherverbrauch               |
| **`ci`**       | CI/CD           | Anpassung von CI/CD-Pipelines und Automatisierungen (z. B. GitHub Actions) |
| **`build`**    | Build-System    | Änderungen, die das Build-System oder externe Abhängigkeiten betreffen     |
| **`revert`**   | Rücknahme       | Macht einen vorherigen Commit rückgängig                                   |

## Betrieb mit Docker

Voraussetzung: Docker mit Compose v2. Node muss dafür nicht installiert sein.

```bash
docker compose up --build -d   # Image bauen und Server im Hintergrund starten (Port 3000)
docker compose ps              # Status, "healthy" sobald GET /health antwortet
docker compose logs -f         # Logs verfolgen
docker compose down            # Server stoppen
```

- Das Image läuft mit Node 22 als Benutzer `node` und enthält nur Laufzeitabhängigkeiten und den kompilierten Code.
- `docker compose` setzt `NODE_ENV=production`. Ohne `CORS_ORIGIN` sind dann keine Browser-Origins erlaubt. Native Apps senden keinen Origin und sind nicht betroffen. Für ein Web-Frontend im Browser: `CORS_ORIGIN='*' docker compose up --build`.
- Port und Umgebungsvariablen lassen sich über die Shell oder eine `.env`-Datei neben `docker-compose.yml` überschreiben, z. B. `HOST_PORT=8080`.
- Die CI baut das Image in jedem Pull Request und prüft den Health-Check.

### Health-Check

`GET /health` antwortet mit `200` und `{ "status": "ok", "uptimeSeconds": 42 }`, solange der Prozess läuft. Docker prüft den Endpunkt alle 30 Sekunden (`HEALTHCHECK` im [`Dockerfile`](Dockerfile)) und meldet den Container nach drei Fehlschlägen in Folge als `unhealthy`.
