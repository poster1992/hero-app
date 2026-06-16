# HERO GraphQL API

Quelle: https://hero-software.de/api-doku/graphql-guide (abgerufen 2026-06-10)

## Überblick

Die GraphQL-API bietet vollständigen Zugriff auf das HERO-Konto: Kontakte,
Projekte, Dokumente, Kalender, Artikel/Produkte, Mitarbeiter, Zeiterfassung
u.v.m. – sowohl lesend (Queries) als auch schreibend (Mutations).

## Endpoint

```
https://login.hero-software.de/api/external/v7/graphql
```

Dieser Endpoint liefert über GraphQL-Introspection auch automatisch
generierte Schema-/Dokumentationsinformationen (z.B. abrufbar über GraphQL-
Clients wie Insomnia, Postman oder GraphiQL).

## Header

```
Authorization: Bearer <api-token>
Content-Type: application/json
```

## Bekannte Queries (Auszug)

| Query | Beschreibung |
|-------|--------------|
| `contacts` | Kontaktverwaltung (Kunden, Filterung nach Kategorie, Offset/Pagination) |
| `project_matches` | Projekte inkl. Kunde, Status, verknüpfte Dokumente |
| `customer_documents` | Kundendokumente |
| `calendar_events` | Termine/Kalender |
| `supply_product_versions` | Artikel-/Produktkatalog |

Laut Help-Center-Artikel ("GraphQL Abfragen") existieren zusätzlich u.a.
Queries für: Arbeitszeiten/Zeiterfassung, Aufträge, Bilder, Dokumenttypen,
Gewerke (trades), Mitarbeiter (employees).

## Bekannte Mutations (Auszug)

| Mutation | Beschreibung |
|----------|--------------|
| `create_contact` | Neuen Kontakt anlegen |
| `create_project_match` | Neues Projekt anlegen |
| `add_logbook_entry` | Logbuch-Eintrag hinzufügen |

## Implementierungsbeispiel

Die Original-Doku enthält ein PHP-Beispiel mit `curl`, das zeigt, wie eine
GraphQL-Query mit Variablen, korrekten Headern (inkl. Authorization) und
Response-Parsing ausgeführt wird – als Beispiel werden die letzten 50
Kunden-Kontakte inkl. Adressen abgefragt.

## TODO

- [ ] Vollständiges PHP/curl-Beispiel von der Originalseite ergänzen
- [ ] Vollständiges Schema per Introspection-Query gegen den Endpoint ziehen,
      sobald ein API-Token vorliegt:
  ```graphql
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      types {
        name
        kind
        description
        fields { name description args { name type { name kind } } type { name kind ofType { name kind } } }
      }
    }
  }
  ```
  Ergebnis lokal als `schema.json` / `schema.graphql` ablegen.
- [ ] Help-Center-Artikel "GraphQL Abfragen"
      (https://support.hero-software.de/hc/de/articles/7399888860828) ist
      hinter Login – Beispielqueries für Zeiterfassung, Aufträge, Bilder,
      Dokumenttypen, Gewerke, Mitarbeiter dort nachtragen
