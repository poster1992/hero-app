# HERO Software API – Übersicht

Quelle: https://hero-software.de/api-doku (abgerufen 2026-06-10)

HERO bietet zwei APIs für die Anbindung externer Systeme an die Handwerkersoftware:

1. **Lead API** (REST) – zum automatischen Anlegen neuer Projekte/Kontakte
   (z.B. aus Kontaktformularen, Partnerportalen, CRM-Systemen).
   → siehe [`lead-api.md`](./lead-api.md)

2. **GraphQL API** – Vollzugriff auf das HERO-Konto: Kontakte, Projekte,
   Dokumente, Kalender, Artikel, Mitarbeiter, Zeiterfassung etc.
   → siehe [`graphql-guide.md`](./graphql-guide.md)

## Authentifizierung (beide APIs)

```
Authorization: Bearer <API-TOKEN>
```

Der API-Token wird vom HERO-Support ausgestellt (Kontakt:
https://hero-software.de/support/kontakt) und muss sicher aufbewahrt werden
(z.B. in einer lokalen `.env`-Datei, niemals im Git-Repo).

## Weiterführende Ressourcen

- Help Center: https://support.hero-software.de/hc/s/
- GraphQL-Beispielabfragen (Login erforderlich):
  https://support.hero-software.de/hc/de/articles/7399888860828-GraphQL-Abfragen
- Video-Tutorials (Akademie): https://community.hero-software.de/c/akademie/
- Support-Kontakt: https://hero-software.de/support/kontakt

## Vollständiges GraphQL-Schema

Das komplette Schema wurde per Introspection abgerufen (Query-Typ:
`PartnerQuery`, Mutation-Typ: `PartnerMutation`, 230 Typen insgesamt):

- [`schema-overview.md`](./schema-overview.md) – lesbare Übersicht aller
  Queries (58), Mutations (75) und ein Index aller Typen
- [`schema.json`](./schema.json) – vollständiges Rohschema (Introspection-
  Result, ~3,5 MB)
- `scripts/show-type.ps1 <TypeName>` – zeigt Felder/Enum-Werte/Input-Felder
  eines einzelnen Typs an, z.B. `Customer`, `ProjectMatch`,
  `CustomerDocument`

## Offene Punkte / TODO

- [ ] GraphQL-Beispielabfragen aus dem Help-Center-Artikel (Login nötig)
      ergänzen, sobald Zugang verfügbar ist
