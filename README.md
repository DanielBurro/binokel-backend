# Binokel Multiplayer App

Netzwerkfähige Mehrspieler-Anwendung für das Kartenspiel Binokel (Studienarbeit an der DHBW).

## Projektstruktur

- `backend/`: Server-Logik und Regel-Engine
- `frontend/`: Mobiler Client (Cross-Platform)

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
