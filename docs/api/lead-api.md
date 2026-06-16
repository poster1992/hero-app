# HERO Lead API

Quelle: https://hero-software.de/api-doku/lead-api (abgerufen 2026-06-10)

## Zweck

Automatisches Anlegen neuer Projekte (inkl. Kunde, Adresse, optionalen
Bildern/Dokumenten) in HERO – z.B. aus einem Kontaktformular auf der eigenen
Website, aus Partnerportalen oder vorgeschalteten CRM-/Lead-Qualifizierungs-
Tools.

## Endpoint

```
POST https://login.hero-software.de/api/v1/Projects/create
```

## Header

```
Authorization: Bearer <api-token>
Content-Type: application/json
```

## Request-Struktur (Top-Level-Felder)

| Feld             | Pflicht | Beschreibung |
|------------------|---------|--------------|
| `measure`        | optional | Gewerke-/Maßnahmen-Code, z.B. `"PVS"` (Photovoltaik), `"PRJ"` (allgemeines Projekt) |
| `customer`       | **ja**   | Mind. E-Mail-Adresse; zusätzlich Vorname/Nachname, Telefonnummern, Firmenname (→ markiert als gewerblicher Kunde) |
| `address`        | **ja**   | Mind. PLZ; Straße, Ort etc. Land wird automatisch anhand der PLZ-Länge erkannt (5-stellig = Deutschland, 4-stellig = Schweiz/Österreich) |
| `projectaddress` | optional | Projektadresse, falls abweichend von `address` (sonst wird `address` übernommen) |
| `project`        | optional | Metadaten zur Quelle/zum Tracking (z.B. Lead-ID) |
| `project_match`  | optional | Steuert initialen Status (`status_code`) und Partner-Benachrichtigung |
| `images`         | optional | Bild-Anhänge |
| `documents`      | optional | Dokument-Anhänge |

## Status-Codes (`project_match.status_code`)

| Code  | Bedeutung |
|-------|-----------|
| 201   | Erstkontakt (Neu) |
| 400   | Besichtigungstermin |
| 601   | Angebotserstellung |
| 801   | Auftrag |
| 1111  | In Bearbeitung |

## Antworten

| HTTP-Status | Bedeutung | Beispiel |
|-------------|-----------|----------|
| 200 OK | Erfolg | `{"status": "success", "id": <project-id>}` |
| 422 Unprocessable Entity | Validierungsfehler | Fehlermeldung mit Details |
| 403 Forbidden | Auth-Fehler (Token fehlt/ungültig) | – |

## Deduplizierung

Kunden werden primär anhand der **E-Mail-Adresse** dedupliziert. Existiert
bereits ein Kunde mit gleicher E-Mail, wird kein neuer Kunde angelegt –
es wird trotzdem ein neues Projekt erzeugt und ein Logbuch-Eintrag mit
Hinweis auf den möglichen Duplikat-Treffer gesetzt.

## TODO

- [ ] Vollständiges JSON-Beispiel-Payload (alle Felder) von der Originalseite
      ergänzen, sobald Zugriff/Kopie möglich ist (Web-Fetch lieferte bisher
      nur eine Zusammenfassung statt Volltext)
- [ ] Mit echtem Test-Token einen Beispiel-Request gegen die Sandbox/Prod-API
      durchführen und Response dokumentieren
