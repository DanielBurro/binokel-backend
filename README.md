# Binokel Multiplayer App

Netzwerkfähige Mehrspieler-Anwendung für das Kartenspiel Binokel (Studienarbeit an der DHBW).

## Projektstruktur

Dieses Repo enthält den Server. Der mobile Client liegt im Repo `binokel-frontend`.

Hexagonale Architektur, Abhängigkeiten zeigen nur nach innen. ESLint erzwingt die Grenzen.

| Ordner             | Aufgabe                                                                  |
| :----------------- | :----------------------------------------------------------------------- |
| `src/domain/`      | Regel-Engine als reine Funktionen, ohne Framework und ohne Netzwerk      |
| `src/application/` | Räume, Sitzungen, Spielablauf, Sicht je Spieler und die Ports            |
| `src/adapters/`    | Socket.IO, Zufall, Speicher und Uhr                                      |
| `src/config/`      | Umgebungsvariablen                                                       |
| `protocol/`        | Aus dem Code erzeugtes JSON Schema des Protokolls, Vertrag fürs Frontend |

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

| Befehl                        | Beschreibung                                                                            |
| :---------------------------- | :-------------------------------------------------------------------------------------- |
| **`npm ci`**                  | Abhängigkeiten exakt installieren und Git-Hooks via Husky einrichten                    |
| **`npm run dev`**             | Entwicklungsserver mit Hot-Reload starten (`tsx watch src/index.ts`)                    |
| **`npm run build`**           | TypeScript-Code kompilieren (`tsc`)                                                     |
| **`npm start`**               | Kompiliertes Backend starten (`node dist/index.js`)                                     |
| **`npm test`**                | Vitest-Tests einmalig ausführen (`vitest run`)                                          |
| **`npm run test:watch`**      | Tests im interaktiven Watch-Modus starten (`vitest`)                                    |
| **`npm run test:coverage`**   | Tests mit V8-Coverage-Bericht ausführen (`vitest run --coverage`)                       |
| **`npm run lint`**            | Statische Code-Analyse mit ESLint durchführen (`eslint src/`)                           |
| **`npm run lint:fix`**        | Behebbare ESLint-Fehler automatisch korrigieren (`eslint src/ --fix`)                   |
| **`npm run format`**          | Code mit Prettier automatisch formatieren (`prettier --write .`)                        |
| **`npm run format:check`**    | Formatierung aller Dateien mit Prettier prüfen (`prettier --check .`)                   |
| **`npm run protocol:export`** | Eingechecktes JSON Schema des Protokolls neu erzeugen (`protocol/protocol.schema.json`) |

Optionale Umgebungsvariablen: `PORT`, `CORS_ORIGIN` (kommaseparierte Origins), `RECONNECT_GRACE_MS`, `ROOM_TTL_MS`.

## Protokoll

Client und Server sprechen über Socket.IO. Der Vertrag steht in [`protocol.ts`](src/adapters/inbound/websocket/protocol.ts) und als JSON Schema in [`protocol/protocol.schema.json`](protocol/protocol.schema.json), aus dem das Frontend seine Typen erzeugt. Nach jeder Änderung am Protokoll `npm run protocol:export` ausführen und die Datei mit einchecken, sonst schlägt ein Test fehl.

| Richtung        | Ereignis         | Zweck                                             |
| :-------------- | :--------------- | :------------------------------------------------ |
| Client → Server | `room:create`    | Raum mit Spielkonfiguration anlegen               |
| Client → Server | `room:join`      | Per Raum-ID beitreten                             |
| Client → Server | `room:leave`     | Raum verlassen                                    |
| Client → Server | `session:resume` | Sitz nach einem Verbindungsabbruch übernehmen     |
| Client → Server | `game:intent`    | Spielzug mit `expectedVersion`                    |
| Server → Client | `room:state`     | Lobby bis zum Spielstart, an alle im Raum         |
| Server → Client | `game:state`     | Persönliche Sicht (`PlayerView`), nur an den Sitz |
| Server → Client | `game:events`    | Öffentliche Ereignisse, an alle im Raum           |

- Jede Client-Nachricht wird mit `{ ok: true, … }` oder `{ ok: false, error: { code, message } }` beantwortet.
- `availableActions` in der `PlayerView` listet die Züge, die der Sitz gerade ausführen darf, samt Spielraum (zum Beispiel den Gebotsbereich). Der Client muss die Regeln nicht nachbauen.
- Jeder Zug trägt die `version` der Sicht, auf der er beruht. Ist sie veraltet, antwortet der Server mit `STALE_STATE`.
- Den Dabb sieht nur der Spielmacher, und erst nach der Aufnahme: `dabb.cards` enthält für ihn bei `status: 'taken'` die aufgenommenen und bei `'discarded'` die gedrückten Karten. Alle anderen Sitze, auch der Partner, bekommen nur `size` und `status`.
- Nach dem Drücken sagt der Spielmacher mit `declare { trump, mode }` Trumpf und Spielart an. Jede Farbe ist als Trumpf erlaubt, `availableActions` bietet die Spielarten `play` und `abgehen` an. Die Ansage steht danach für alle Sitze in `declaration`, und die Runde wechselt in `meld`, auch beim Abgehen (dann melden nur die Gegenparteien, danach folgt direkt die Abrechnung).
- Gemeldet wird ab dem Spielmacher in Spielrichtung, beim Abgehen nur von den Gegenparteien. Der Server bietet dem Sitz am Zug über `availableActions` (`{ type: 'submitMelds', melds }`) die punktehöchste gültige Auswahl seiner Hand an. Mit `submitMelds { meldIds }` meldet der Sitz diese Auswahl oder einen Teil davon, auch gar nichts (`meldIds: []`). Gemeldete Karten und Punkte sind öffentlich und stehen für alle Sitze in `melds`. Ob sie zählen, entscheidet erst die Abrechnung (mindestens ein Stich).
- Im Stichspiel spielt die Vorhand den ersten Stich aus, danach der Gewinner des vorherigen. Der Sitz am Zug bekommt `{ type: 'playCard', cardIds }` mit genau den Karten, die Farb-, Stich- und Trumpfzwang erlauben, und legt mit `playCard { cardId }` eine davon. Andere Karten lehnt der Server mit `CARD_NOT_ALLOWED` ab. `trick` zeigt allen den laufenden Stich, `lastTrick` den zuletzt abgeschlossenen samt Gewinner. Nach dem letzten Stich steht die Runde in `score`.
- Nach dem letzten Stich, beim Abgehen direkt nach dem Melden, wertet der Server die Runde und schreibt `scores` fort. `roundResult` zeigt allen `outcome` (`made`, `failed`, `abgehen`) und je Partei `trickPoints` (gerundet, mit letztem Stich und gedrücktem Dabb), `meldPoints`, `meldsCounted` (verfallen ohne Stich oder bei verfehltem Gebot) und `delta`. Beim Abgehen enthält `delta` der Gegner die 10 Punkte je Spieler am Tisch. Dazu kommt das Ereignis `roundScored`.
- Das Protokoll beschreibt bereits die ganze Runde. Der Server setzt bisher eine Runde bis zur Abrechnung um: Der Zug `readyForNextRound` wird noch abgelehnt, und die Felder `readySeats` und `winners` bleiben leer.

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
