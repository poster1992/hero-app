import { cache } from "react";

const HERO_GRAPHQL_ENDPOINT = "https://login.hero-software.de/api/external/v7/graphql";

/**
 * Der HERO-API-Token für den aktuellen Request: der PERSÖNLICHE Token des angemeldeten
 * Benutzers, sonst der Firmen-Token aus der Umgebung. So laufen HERO-Aktionen (v.a.
 * Logbuch-Einträge) unter dem echten Benutzer – HERO leitet den Autor aus dem Token ab.
 *
 * - `cache()` sorgt dafür, dass Session + DB-Lookup nur EINMAL pro Request passieren.
 * - `getSession`/`getUserHeroToken` werden dynamisch importiert, damit dieser (server-
 *   seitige) Code nicht über `import type`-Nutzer ins Client-Bundle gezogen wird.
 * - Außerhalb eines Requests (Workflow-Cron) wirft `cookies()` → Fallback Firmen-Token.
 */
export const currentHeroToken = cache(async (): Promise<string | null> => {
  const company = process.env.HERO_API_TOKEN?.trim() || null;
  try {
    const { getSession } = await import("./session");
    const session = await getSession();
    if (!session) return company;
    const { getUserHeroToken } = await import("./users");
    const personal = await getUserHeroToken(session.username);
    return personal || company;
  } catch {
    return company;
  }
});

/**
 * INTERNER GraphQL-Endpoint von HERO (den die eigene Weboberfläche nutzt).
 * Er kennt Dinge, die die externe API NICHT hat – u.a. `tracking_workdays` und die
 * Freigabe-Mutation `confirm_tracking_workdays` (Arbeitszeit-Tagesfreigabe). Unser
 * Bearer-Token wird akzeptiert. Undokumentiert – kann sich bei HERO-Updates ändern.
 * Named Operations müssen als `?op=<Name>` in der URL wiederholt werden.
 */
const HERO_INTERNAL_ENDPOINT = "https://login.hero-software.de/Api/graphql";

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/** HTTP-Status, die als vorübergehend (Gateway/Überlast) gelten und wiederholt werden. */
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Seitengröße der Offset-Paginierer.
 *
 * HERO erlaubt große Seiten – gemessen: `first: 5000` liefert alle 4.713 Zeiteinträge
 * in EINEM Request (~1,0 s) statt in 24 seriellen Seiten à 200 (~5,4 s). Da jede Seite
 * ein eigener HTTP-Roundtrip (~260 ms) ist, ist die Seitengröße der größte Hebel.
 *
 * Die Schleifen brechen bewusst NUR bei einer leeren Seite ab und rücken um die
 * TATSÄCHLICH gelieferte Anzahl weiter (nicht um `pageSize`). Würde HERO die Seitengröße
 * intern deckeln (z.B. 5000 angefordert, nur 1000 geliefert), fehlten sonst kommentarlos
 * Daten – der schlimmste Fehlertyp, weil die Seite weiter plausible Zahlen zeigt.
 * Preis dafür: ein zusätzlicher (leerer) Request am Ende jeder Paginierung.
 */
const HERO_PAGE_SIZE = 1000;
/**
 * ACHTUNG – HERO begrenzt nicht die Seitengröße, sondern die QUERY-KOMPLEXITÄT:
 * `first` × Anzahl der selektierten Felder darf **50.000** nicht überschreiten
 * ("Max query complexity should be 50000 but got …"). Feldreiche Queries brauchen
 * deshalb eine kleinere Seite: Kalender-Termine und Projekt-Adressen wiegen ~52–54
 * Punkte je Datensatz und sprengen das Limit bereits bei `first: 1000`.
 *
 * 500 lässt bewusst Reserve: Wer dieser Query später ein Feld hinzufügt, soll nicht
 * die Seite lahmlegen. Wird hier je erhöht, vorher mit dem echten Feldsatz messen.
 */
const HERO_PAGE_SIZE_RICH = 500;
/** tracking_times ist der größte Datensatz (~4.700 Einträge) und wählt nur 3 Felder – volle Seite. */
const HERO_TRACKING_PAGE_SIZE = 5000;
/** Reines Sicherheitsnetz gegen Endlosschleifen; die Paginierung endet normal über die leere Seite. */
const HERO_MAX_PAGES = 100;

export async function heroGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
  retries = 3
): Promise<T> {
  const token = await currentHeroToken();
  if (!token) {
    throw new Error("HERO_API_TOKEN is not configured");
  }

  const body = JSON.stringify({ query, variables });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Timeout je Versuch, damit hängende Requests nicht die ganze Seite blockieren.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(HERO_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (e) {
      // Netzwerkfehler/Timeout → als vorübergehend behandeln und erneut versuchen.
      clearTimeout(timer);
      lastError = e instanceof Error ? e : new Error("HERO API network error");
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    if (!res.ok) {
      if (TRANSIENT_STATUS.has(res.status) && attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new Error(`HERO API request failed: ${res.status} ${res.statusText}`);
    }

    const json: GraphQLResponse<T> = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    if (!json.data) {
      throw new Error("HERO API returned no data");
    }
    return json.data;
  }

  throw lastError ?? new Error("HERO API request failed");
}

/**
 * Ruft den internen HERO-Endpoint (`/Api/graphql`) auf. `operationName` MUSS zum Namen
 * in der Query passen und wird zusätzlich als `?op=` an die URL gehängt (so macht es
 * HEROs eigene Oberfläche). Sonst identisch zu heroGraphQL (Bearer, Retry, Timeout).
 */
async function heroInternalGraphQL<T>(
  operationName: string,
  query: string,
  variables?: Record<string, unknown>,
  retries = 3
): Promise<T> {
  const token = await currentHeroToken();
  if (!token) throw new Error("HERO_API_TOKEN is not configured");

  const url = `${HERO_INTERNAL_ENDPOINT}?op=${encodeURIComponent(operationName)}`;
  const body = JSON.stringify({ operationName, query, variables });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastError = e instanceof Error ? e : new Error("HERO internal API network error");
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timer);

    if (!res.ok) {
      if (TRANSIENT_STATUS.has(res.status) && attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw new Error(`HERO internal API request failed: ${res.status} ${res.statusText}`);
    }

    const json: GraphQLResponse<T> = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (!json.data) throw new Error("HERO internal API returned no data");
    return json.data;
  }

  throw lastError ?? new Error("HERO internal API request failed");
}

// --- Arbeitszeit-Tagesfreigabe (tracking_workdays, interner Endpoint) ---

/** Ein Arbeitstag eines Mitarbeiters mit Freigabe-Status. */
export interface Workday {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  partnerId: number;
  partnerName: string;
  /** Erfasste Arbeitszeit in Stunden. */
  workedHours: number;
  /** Soll-Arbeitszeit in Stunden (0, wenn kein Soll hinterlegt). */
  targetHours: number;
  /** true = in HERO freigegeben (status_code 200), false = eingereicht (100). */
  confirmed: boolean;
}

/** HERO-Statuscodes eines Arbeitstags. */
const WORKDAY_STATUS_SUBMITTED = 100;
const WORKDAY_STATUS_CONFIRMED = 200;

interface RawWorkday {
  id: number;
  date: string | null;
  status_code: number | null;
  partner_id: number | null;
  worked_time: number | null; // Sekunden
  daily_target: number | null; // Sekunden
}

/**
 * Arbeitstage im Zeitraum [from, to] (YYYY-MM-DD) samt Freigabe-Status.
 *
 * Nutzt den internen Endpoint (die externe API kennt `tracking_workdays` nicht). Die
 * Namen werden über eine schlanke separate `tracking_times`-Abfrage aufgelöst statt in
 * die Workday-Query verschachtelt – das hielte sonst das Query-Komplexitätslimit nicht.
 */
export async function getWorkdays(from: string, to: string): Promise<Workday[]> {
  // WICHTIG: ohne `first` deckelt HERO tracking_workdays still auf 50 Datensätze
  // (gemessen). Die 6-Feld-Query bleibt bei first:5000 unter dem Komplexitätslimit.
  // Die Freigabe-Ansicht arbeitet mit Wochen/Monaten – 5000 Tage sind reichlich Reserve.
  const data = await heroInternalGraphQL<{ tracking_workdays: RawWorkday[] | null }>(
    "TrackingWorkdaysQuery",
    `query TrackingWorkdaysQuery($start: Date, $end: Date, $first: Int) {
      tracking_workdays(start: $start, end: $end, first: $first) {
        id
        date
        status_code
        partner_id
        worked_time
        daily_target
      }
    }`,
    { start: from, end: to, first: HERO_TRACKING_PAGE_SIZE }
  );
  const workdays = data.tracking_workdays ?? [];
  if (workdays.length === 0) return [];

  // Namen der beteiligten Mitarbeiter auflösen (partner_id -> Name), schlanke Query.
  const names = await getPartnerNames(from, to);

  return workdays
    .filter((w) => w.date && w.status_code != null)
    .map((w) => ({
      id: w.id,
      date: w.date as string,
      partnerId: w.partner_id ?? 0,
      partnerName: names.get(w.partner_id ?? -1) ?? `Mitarbeiter ${w.partner_id ?? "?"}`,
      workedHours: Math.round(((w.worked_time ?? 0) / 3600) * 100) / 100,
      targetHours: Math.round(((w.daily_target ?? 0) / 3600) * 100) / 100,
      confirmed: w.status_code === WORKDAY_STATUS_CONFIRMED,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.partnerName.localeCompare(b.partnerName, "de"));
}

/** partner_id -> Anzeigename, aus den Zeiteinträgen des Zeitraums (schlanke Query). */
async function getPartnerNames(from: string, to: string): Promise<Map<number, string>> {
  const data = await heroInternalGraphQL<{
    tracking_times: { partner_id: number | null; partner: { id: number; name: string | null } | null }[] | null;
  }>(
    "TrackingTimePartnersQuery",
    `query TrackingTimePartnersQuery($start: Date, $end: Date, $first: Int) {
      tracking_times(show_all_partners: true, start: $start, end: $end, first: $first, orderBy: "id") {
        partner_id
        partner { id name }
      }
    }`,
    { start: from, end: to, first: HERO_TRACKING_PAGE_SIZE }
  );
  const map = new Map<number, string>();
  for (const t of data.tracking_times ?? []) {
    const id = t.partner?.id ?? t.partner_id;
    if (id != null && t.partner?.name && !map.has(id)) map.set(id, t.partner.name);
  }
  return map;
}

/**
 * Gibt Arbeitstage frei (status 100 → 200) über HEROs interne Mutation.
 *
 * Achtung: `confirm_tracking_workdays` liefert `true` auch bei nicht existierenden IDs –
 * der Rückgabewert ist KEIN Erfolgsbeweis. Der Aufrufer sollte die betroffenen Tage
 * anschließend neu laden und den Status prüfen (so macht es freigabeWorkdaysAction).
 * Getestet 2026-07: Statuswechsel 100→200 real verifiziert.
 */
export async function confirmWorkdays(ids: number[]): Promise<void> {
  const clean = ids.filter((n) => Number.isFinite(n) && n > 0);
  if (clean.length === 0) return;
  await heroInternalGraphQL(
    "ConfirmTrackingWorkdays",
    `mutation ConfirmTrackingWorkdays($ids: [Int]) {
      confirm_tracking_workdays(ids: $ids)
    }`,
    { ids: clean }
  );
}

/** Ein einzelner Zeitabschnitt innerhalb eines Arbeitstags (für Detailansicht + Bearbeiten). */
export interface WorkdayTime {
  id: number;
  /** Identifiziert den Eintrag beim Speichern (update_tracking_workday nutzt uuid, nicht id). */
  uuid: string;
  /** ISO-Datetime mit Zeitzone. */
  start: string | null;
  end: string | null;
  /** Dauer in Minuten. */
  minutes: number;
  /** Kategorie-Name, z.B. "Umsetzung", "Pause". */
  category: string | null;
  categoryId: number | null;
  /** Projektname (leer, wenn keinem Projekt zugeordnet). */
  project: string | null;
  projectRelativeId: number | null;
  projectMatchId: number | null;
  fieldServiceJobId: number | null;
  comment: string;
}

interface RawWorkdayTime {
  id: number;
  uuid: string;
  tracking_workday_id: number | null;
  start: string | null;
  end: string | null;
  duration_in_seconds: number | null;
  comment: string | null;
  project_match_id: number | null;
  field_service_job_id: number | null;
  tracking_times_category_id: number | null;
  project_match: { name: string | null; relative_id: number | null } | null;
  tracking_times_category: { name: string | null } | null;
}

/**
 * Die einzelnen Zeitabschnitte aller Arbeitstage eines Datums, gruppiert nach
 * `tracking_workday_id`. Ein Tag teilt sich über alle Mitarbeiter; deshalb wird
 * einmal pro Datum geladen und in der UI je Mitarbeiter aus der Map gezogen.
 */
export async function getWorkdayTimesByDate(date: string): Promise<Map<number, WorkdayTime[]>> {
  const data = await heroInternalGraphQL<{ tracking_times: RawWorkdayTime[] | null }>(
    "TrackingTimeDetailsQuery",
    `query TrackingTimeDetailsQuery($start: Date, $end: Date, $first: Int) {
      tracking_times(show_all_partners: true, start: $start, end: $end, first: $first, orderBy: "start") {
        id
        uuid
        tracking_workday_id
        start
        end
        duration_in_seconds
        comment
        project_match_id
        field_service_job_id
        tracking_times_category_id
        project_match { name relative_id }
        tracking_times_category { name }
      }
    }`,
    { start: date, end: date, first: HERO_TRACKING_PAGE_SIZE }
  );

  const byWorkday = new Map<number, WorkdayTime[]>();
  for (const t of data.tracking_times ?? []) {
    if (t.tracking_workday_id == null) continue;
    const list = byWorkday.get(t.tracking_workday_id) ?? [];
    list.push({
      id: t.id,
      uuid: t.uuid,
      start: t.start,
      end: t.end,
      minutes: Math.round((t.duration_in_seconds ?? 0) / 60),
      category: t.tracking_times_category?.name ?? null,
      categoryId: t.tracking_times_category_id ?? null,
      project: t.project_match?.name ?? null,
      projectRelativeId: t.project_match?.relative_id ?? null,
      // HERO nutzt 0 für "keinem Projekt/Auftrag zugeordnet" → als null führen, damit
      // die Bearbeiten-Auswahl "— kein Projekt —" zeigt (0 hätte keine passende Option).
      projectMatchId: t.project_match_id || null,
      fieldServiceJobId: t.field_service_job_id || null,
      comment: t.comment ?? "",
    });
    byWorkday.set(t.tracking_workday_id, list);
  }
  return byWorkday;
}

/** Eine Zeiterfassungs-Kategorie (z.B. "Umsetzung", "Pause") für die Auswahl beim Bearbeiten. */
export interface TrackingCategory {
  id: number;
  name: string;
  /** false = zählt nicht als Arbeitszeit (z.B. Pause). */
  isWorkingTime: boolean;
}

/** Alle aktiven Zeiterfassungs-Kategorien (interner Endpoint). */
export async function getTrackingCategories(): Promise<TrackingCategory[]> {
  const data = await heroInternalGraphQL<{
    tracking_times_categories: { id: number; name: string | null; is_working_time: boolean | null }[] | null;
  }>(
    "TrackingTimesCategories",
    `query TrackingTimesCategories($first: Int, $is_active: Boolean, $orderBy: String) {
      tracking_times_categories(is_active: $is_active, first: $first, orderBy: $orderBy) {
        id
        name
        is_working_time
      }
    }`,
    { first: 200, is_active: true, orderBy: "name" }
  );
  return (data.tracking_times_categories ?? [])
    .filter((c) => c.name)
    .map((c) => ({ id: c.id, name: c.name as string, isWorkingTime: c.is_working_time !== false }));
}

/** Ein zu speichernder Zeitabschnitt beim Bearbeiten eines Arbeitstags. */
export interface WorkdayTimeEdit {
  /** Identifiziert den bestehenden Zeiteintrag. */
  uuid: string;
  /** ISO-Datetime mit Zeitzone. */
  start: string | null;
  end: string | null;
  comment: string;
  /** 0/null = keinem Projekt zugeordnet. */
  projectMatchId: number | null;
  categoryId: number | null;
  fieldServiceJobId: number | null;
}

/**
 * Speichert die Zeitabschnitte eines Arbeitstags über HEROs interne Mutation
 * `update_tracking_workday` (die einzige, die auch EINGEREICHTE Tage bearbeiten lässt –
 * `update_tracking_time` verweigert die mit "Bereits Eingereichte …").
 *
 * WICHTIG (getestet 2026-07):
 * - Der Workday-`status_code` MUSS mitgesendet werden, sonst "status_code darf nicht leer".
 *   Wir senden den unveränderten aktuellen Status, damit die Freigabe erhalten bleibt.
 * - Es müssen ALLE Zeiten des Tages mitgesendet werden (Patch-Semantik). Fehlende Einträge
 *   könnten sonst verworfen werden – der Aufrufer lädt darum immer den kompletten Tag.
 * - `status_code` gehört NUR an den Workday, NICHT an den einzelnen Zeiteintrag.
 */
export async function updateWorkdayTimes(
  workdayId: number,
  workdayStatusCode: number,
  times: WorkdayTimeEdit[]
): Promise<void> {
  await heroInternalGraphQL(
    "UpdateTrackingWorkday",
    `mutation UpdateTrackingWorkday($x: Employees_UpdateTrackingWorkdayInput) {
      update_tracking_workday(tracking_workday: $x) { id status_code }
    }`,
    {
      x: {
        id: workdayId,
        status_code: workdayStatusCode,
        tracking_times: times.map((t) => ({
          uuid: t.uuid,
          start: t.start,
          end: t.end,
          comment: t.comment ?? "",
          // HERO erwartet 0 (nicht null) für "kein Projekt/Auftrag" – im Test verifiziert.
          project_match_id: t.projectMatchId ?? 0,
          tracking_times_category_id: t.categoryId ?? null,
          field_service_job_id: t.fieldServiceJobId ?? 0,
        })),
      },
    }
  );
}

export { WORKDAY_STATUS_SUBMITTED, WORKDAY_STATUS_CONFIRMED };

export type ReceiptType = "output" | "income";

export interface ReceiptCustomer {
  id: number | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface Receipt {
  id: string;
  type: ReceiptType;
  number: string;
  receiptDate: string | null;
  dueDate: string | null;
  paidDate: string | null;
  netValue: number;
  value: number;
  paidSum: number;
  openAmount: number;
  statusCode: number;
  customer: ReceiptCustomer | null;
  fileUpload: ReceiptFileUpload | null;
  receiptPositions: ReceiptPosition[];
}

export interface ReceiptFileUpload {
  id: number;
  filename: string;
  /** MIME type, e.g. "application/pdf". */
  type: string | null;
  /** Relative source path on the HERO host, e.g. "/files/product/product/xyz.pdf". */
  src: string | null;
  thumbnails: { fit256: string | null; fit512: string | null } | null;
}

export interface ReceiptProjectMatch {
  id: number;
  relativeId: number | null;
  name: string;
}

export interface ReceiptPosition {
  vat: number;
  valueInclVat: number;
  valueExclVat: number;
  projectMatch: ReceiptProjectMatch | null;
  bookAccount: { num: string; name: string } | null;
}

interface ReceiptConnection {
  Receipt_Receipts: {
    edges: { node: Receipt }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const RECEIPTS_QUERY = `
  query ReceiptsInRange($from: DateTime!, $to: DateTime!, $after: String) {
    Receipt_Receipts(
      first: 1000
      after: $after
      filters: { receiptDate: { greaterThanOrEqual: $from, lessThanOrEqual: $to } }
      sortings: [RECEIPT_DATE_ASC]
    ) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          type
          number
          receiptDate
          dueDate
          paidDate
          netValue
          value
          paidSum
          openAmount
          statusCode
          customer {
            id
            companyName
            firstName
            lastName
          }
          fileUpload {
            id
            filename
            type
            src
            thumbnails {
              fit256
              fit512
            }
          }
          receiptPositions {
            vat
            valueInclVat
            valueExclVat
            projectMatch {
              id
              relativeId
              name
            }
            bookAccount {
              num
              name
            }
          }
        }
      }
    }
  }
`;

/** Fetches all receipts ("Belege") with a receiptDate within [from, to] (ISO datetime strings). */
export async function getReceiptsInRange(from: string, to: string): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  // HERO's API throws an internal TypeError if "after" is sent as an explicit
  // null variable, so it must be omitted (undefined) for the first page.
  let after: string | undefined;

  for (;;) {
    const data: ReceiptConnection = await heroGraphQL<ReceiptConnection>(RECEIPTS_QUERY, { from, to, after });
    const { edges, pageInfo } = data.Receipt_Receipts;
    receipts.push(...edges.map((e) => e.node));
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor ?? undefined;
  }

  return receipts;
}

/** Schreibt einen Logbuch-Eintrag (Notiz) zu einem Projekt in HERO. */
export async function writeProjectLogbook(projectId: number, text: string): Promise<void> {
  const note = text.trim();
  if (!note) return;
  await heroGraphQL(
    `mutation AddLog($entry: LogbookEntryInput!) {
      add_logbook_entry(logbook_entry: $entry) { id }
    }`,
    { entry: { target: "project_match", target_id: projectId, custom_text: note } }
  );
}

export interface CompanyBank {
  name: string | null;
  iban: string | null;
  bic: string | null;
}

/** The company's own bank details (debtor account for SEPA exports). */
export async function getCompanyBankInfo(): Promise<CompanyBank> {
  const data = await heroGraphQL<{
    company: { name: string | null; iban: string | null; bic: string | null } | null;
  }>(`query { company { name iban bic } }`);
  return {
    name: data.company?.name ?? null,
    iban: data.company?.iban ?? null,
    bic: data.company?.bic ?? null,
  };
}

// ---------------------------------------------------------------------------
// Customer invoices ("Rechnungen", RE2026-*) — these live in customer_documents,
// NOT in Receipt_Receipts. Document type ids for FloorTec:
//   Rechnung = 1057585, Gutschrift = 1057587, Stornorechnung = 1057595.
// Stornorechnungen carry negative amounts (they reverse an invoice).
// ---------------------------------------------------------------------------

const INVOICE_DOCUMENT_TYPE_IDS = [1057585, 1057587, 1057595];

// Gutschrift + Stornorechnung mindern den Umsatz (immer als Betragsabzug).
const REVENUE_REDUCTION_TYPE_IDS = new Set([1057587, 1057595]);

/** True if the document type reduces revenue (Gutschrift/Storno). */
export function isRevenueReduction(documentTypeId: number | null): boolean {
  return documentTypeId != null && REVENUE_REDUCTION_TYPE_IDS.has(documentTypeId);
}

export interface CustomerInvoice {
  id: string;
  number: string;
  date: string | null;
  /** Gross amount (net + tax). */
  gross: number;
  /** Tax amount (vat). */
  tax: number;
  /** Net amount (CustomerDocument.value). */
  net: number;
  statusName: string | null;
  customerName: string | null;
  project: { id: number; name: string } | null;
  fileUpload: ReceiptFileUpload | null;
  /** Payment status from the booking (e.g. "Bezahlt"/"Offen"), or null if none. */
  paymentStatusName: string | null;
  /** True if the invoice is still open (not fully paid). */
  isOpen: boolean | null;
  paidDate: string | null;
  dueDate: string | null;
  /** Open balance (remaining amount), or null. */
  balance: number | null;
  /** Customer contact id + email (from the customer master), if available. */
  customerId: number | null;
  customerEmail: string | null;
  /** HERO document type id (Rechnung/Gutschrift/Storno). */
  documentTypeId: number | null;
  /** Referenced original document id (Storno/Gutschrift → Originalrechnung). */
  selectedDocumentId: number | null;
  /**
   * Rechnungsart (metadata.invoice_style):
   * "parted" = Teilrechnung, "downpayment" = Abschlagsrechnung,
   * "cumulative" = kumulative Schlussrechnung, "full" = (End-)Vollrechnung.
   */
  invoiceStyle: string | null;
}

interface RawCustomerDocument {
  id: number;
  nr: string | null;
  date: string | null;
  value: number | null;
  vat: number | null;
  status_code: number | null;
  status_name: string | null;
  document_type_id: number | null;
  selected_document_id: number | null;
  customer: { id: number; company_name: string | null; full_name: string | null; email: string | null } | null;
  project_match: { id: number; name: string } | null;
  file_upload: { id: number; filename: string; type: string | null; src: string | null } | null;
  customer_document_booking: {
    status_name: string | null;
    is_open: boolean | null;
    paid_date: string | null;
    due_date: string | null;
    balance: number | null;
  } | null;
  metadata: { invoice_style: string | null } | null;
}

const CUSTOMER_INVOICES_QUERY = `
  query CustomerInvoices($typeIds: [Int], $first: Int, $offset: Int) {
    customer_documents(document_type_ids: $typeIds, orderBy: "id", first: $first, offset: $offset) {
      id
      nr
      date
      value
      vat
      status_code
      status_name
      document_type_id
      selected_document_id
      metadata { invoice_style }
      customer { id company_name full_name email }
      project_match { id name }
      file_upload { id filename type src }
      customer_document_booking { status_name is_open paid_date due_date balance }
    }
  }
`;

/** Fetches all customer invoices (document type "Rechnung"), paginated. */
export async function getCustomerInvoices(): Promise<CustomerInvoice[]> {
  return getCustomerDocumentsByType(INVOICE_DOCUMENT_TYPE_IDS);
}

/** Fetches all customer documents of the given document type ids, paginated. */
export async function getCustomerDocumentsByType(typeIds: number[]): Promise<CustomerInvoice[]> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const result: CustomerInvoice[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{ customer_documents: RawCustomerDocument[] }>(
      CUSTOMER_INVOICES_QUERY,
      { typeIds, first: pageSize, offset }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      // Gelöschte Dokumente (status_code 1000) ausblenden.
      if (d.status_code === 1000) continue;
      // For CustomerDocument, `value` is the NET amount and `vat` the tax amount
      // (unlike Receipt_Receipt, where `value` is gross).
      const net = d.value ?? 0;
      const tax = d.vat ?? 0;
      result.push({
        id: String(d.id),
        number: d.nr ?? "",
        date: d.date,
        gross: net + tax,
        tax,
        net,
        statusName: d.status_name,
        customerName: d.customer
          ? d.customer.company_name || d.customer.full_name || null
          : null,
        customerId: d.customer?.id ?? null,
        customerEmail: d.customer?.email ?? null,
        project: d.project_match ? { id: d.project_match.id, name: d.project_match.name } : null,
        fileUpload:
          d.file_upload?.src != null
            ? {
                id: d.file_upload.id,
                filename: d.file_upload.filename,
                type: d.file_upload.type,
                src: d.file_upload.src,
                thumbnails: null,
              }
            : null,
        paymentStatusName: d.customer_document_booking?.status_name ?? null,
        isOpen: d.customer_document_booking?.is_open ?? null,
        paidDate: d.customer_document_booking?.paid_date ?? null,
        dueDate: d.customer_document_booking?.due_date ?? null,
        balance: d.customer_document_booking?.balance ?? null,
        documentTypeId: d.document_type_id ?? null,
        selectedDocumentId: d.selected_document_id ?? null,
        invoiceStyle: d.metadata?.invoice_style ?? null,
      });
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Project locations (Einsatzorte) — for the Luxembourg map.
// ---------------------------------------------------------------------------

export interface ProjectLocation {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
  lat: number;
  lng: number;
  city: string | null;
  street: string | null;
  zipcode: string | null;
  /** True if the project has an Auftragsbestätigung (1057579) or Rechnung (1057585). */
  hasOrder: boolean;
}

/** Projects (project_matches) that have geocoded addresses, for plotting on a map. */
export async function getProjectLocations(): Promise<ProjectLocation[]> {
  // Feldreich (Adresse + Kunde) → Komplexitätslimit, siehe HERO_PAGE_SIZE_RICH.
  const pageSize = HERO_PAGE_SIZE_RICH;
  const maxPages = HERO_MAX_PAGES;
  const result: ProjectLocation[] = [];
  // Auftragsbestätigung = 1057579, Rechnung = 1057585; status 1000 = gelöscht.
  const ORDER_DOC_TYPES = new Set([1057579, 1057585]);

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      project_matches: {
        id: number;
        relative_id: number | null;
        name: string | null;
        customer: { company_name: string | null; full_name: string | null } | null;
        customer_documents: { document_type_id: number | null; status_code: number | null }[] | null;
        address: {
          city: string | null;
          street: string | null;
          zipcode: string | null;
          latitude: number | null;
          longitude: number | null;
        } | null;
      }[];
    }>(
      `query ProjectLocations($first: Int, $offset: Int) {
        project_matches(type: "project", orderBy: "id", first: $first, offset: $offset) {
          id
          relative_id
          name
          customer { company_name full_name }
          customer_documents { document_type_id status_code }
          address { city street zipcode latitude longitude }
        }
      }`,
      { first: pageSize, offset }
    );
    const matches = data.project_matches ?? [];
    for (const m of matches) {
      const lat = m.address?.latitude;
      const lng = m.address?.longitude;
      if (lat == null || lng == null) continue;
      const hasOrder = (m.customer_documents ?? []).some(
        (d) =>
          d.document_type_id != null &&
          ORDER_DOC_TYPES.has(d.document_type_id) &&
          d.status_code !== 1000
      );
      result.push({
        id: m.id,
        relativeId: m.relative_id,
        name: m.name ?? `Projekt #${m.id}`,
        customerName: m.customer
          ? m.customer.company_name || m.customer.full_name || null
          : null,
        lat,
        lng,
        city: m.address?.city ?? null,
        street: m.address?.street ?? null,
        zipcode: m.address?.zipcode ?? null,
        hasOrder,
      });
    }
    if (matches.length === 0) break;
    offset += matches.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Customers / contacts.
// ---------------------------------------------------------------------------

export interface CustomerSummary {
  id: number;
  nr: string | null;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  zipcode: string | null;
  city: string | null;
  categoryName: string | null;
}

/** Findet den kanonischen HERO-Kontaktnamen zu einem Suchbegriff (bester Treffer), oder null. */
export async function findContactNameBySearch(search: string): Promise<string | null> {
  const s = search.trim();
  if (!s) return null;
  const data = await heroGraphQL<{
    contacts: { company_name: string | null; full_name: string | null }[] | null;
  }>(
    `query FindContact($s: String) { contacts(search: $s, first: 1) { company_name full_name } }`,
    { s }
  );
  const c = data.contacts?.[0];
  if (!c) return null;
  return c.company_name?.trim() || c.full_name?.trim() || null;
}

/** All contacts (customers/suppliers), paginated. */
export async function getCustomers(): Promise<CustomerSummary[]> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const result: CustomerSummary[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      contacts: {
        id: number;
        nr: string | null;
        full_name: string | null;
        company_name: string | null;
        email: string | null;
        phone_mobile: string | null;
        phone_home: string | null;
        category_name: string | null;
        address: { street: string | null; zipcode: string | null; city: string | null } | null;
      }[];
    }>(
      `query Customers($first: Int, $offset: Int) {
        contacts(orderBy: "company_name", first: $first, offset: $offset) {
          id
          nr
          full_name
          company_name
          email
          phone_mobile
          phone_home
          category_name
          address { street zipcode city }
        }
      }`,
      { first: pageSize, offset }
    );
    const contacts = data.contacts ?? [];
    for (const c of contacts) {
      result.push({
        id: c.id,
        nr: c.nr,
        name: c.full_name || c.company_name || `Kontakt #${c.id}`,
        companyName: c.company_name || null,
        email: c.email,
        phone: c.phone_mobile || c.phone_home || null,
        street: c.address?.street ?? null,
        zipcode: c.address?.zipcode ?? null,
        city: c.address?.city ?? null,
        categoryName: c.category_name,
      });
    }
    if (contacts.length === 0) break;
    offset += contacts.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Calendar events (Kalender / Terminplanung) — used for employee utilisation.
// ---------------------------------------------------------------------------

export interface CalendarEventLite {
  id: number;
  title: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  partners: { id: number; name: string; role: string | null }[];
  /** HERO project match id (to open the project), or null. */
  projectId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
}

/** Calendar events overlapping [from, to] (ISO datetime), with assigned partners. */
export async function getCalendarEvents(from: string, to: string): Promise<CalendarEventLite[]> {
  // Feldreich (Termin + Partner + Projekt) → Komplexitätslimit, siehe HERO_PAGE_SIZE_RICH.
  const pageSize = HERO_PAGE_SIZE_RICH;
  const maxPages = HERO_MAX_PAGES;
  const result: CalendarEventLite[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      calendar_events: {
        id: number;
        title: string | null;
        start: string | null;
        end: string | null;
        all_day: boolean | null;
        deleted: boolean | null;
        partners: { id: number; name: string | null; role: string | null }[] | null;
        project_match: { id: number | null; relative_id: number | null; name: string | null } | null;
      }[];
    }>(
      `query CalendarEvents($start: DateTime, $end: DateTime, $first: Int, $offset: Int) {
        calendar_events(start: $start, end: $end, orderBy: "start", first: $first, offset: $offset) {
          id
          title
          start
          end
          all_day
          deleted
          partners { id name role }
          project_match { id relative_id name }
        }
      }`,
      { start: from, end: to, first: pageSize, offset }
    );
    const events = data.calendar_events ?? [];
    for (const e of events) {
      if (e.deleted) continue;
      result.push({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.all_day ?? false,
        partners: (e.partners ?? []).map((p) => ({
          id: p.id,
          name: p.name ?? "Unbekannt",
          role: p.role ?? null,
        })),
        projectId: e.project_match?.id ?? null,
        projectRelativeId: e.project_match?.relative_id ?? null,
        projectName: e.project_match?.name ?? null,
      });
    }
    if (events.length === 0) break;
    offset += events.length;
  }

  return result;
}

/** All (non-deleted) calendar events linked to a project, any date. */
export async function getCalendarEventsForProject(
  projectMatchId: number
): Promise<CalendarEventLite[]> {
  // Feldreich (Termin + Partner + Projekt) → Komplexitätslimit, siehe HERO_PAGE_SIZE_RICH.
  const pageSize = HERO_PAGE_SIZE_RICH;
  const maxPages = HERO_MAX_PAGES;
  const result: CalendarEventLite[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      calendar_events: {
        id: number;
        title: string | null;
        start: string | null;
        end: string | null;
        all_day: boolean | null;
        deleted: boolean | null;
        partners: { id: number; name: string | null; role: string | null }[] | null;
        project_match: { id: number | null; relative_id: number | null; name: string | null } | null;
      }[];
    }>(
      `query CalendarEventsForProject($pid: Int, $first: Int, $offset: Int) {
        calendar_events(project_match_id: $pid, show_deleted: false, orderBy: "start", first: $first, offset: $offset) {
          id
          title
          start
          end
          all_day
          deleted
          partners { id name role }
          project_match { id relative_id name }
        }
      }`,
      { pid: projectMatchId, first: pageSize, offset }
    );
    const events = data.calendar_events ?? [];
    for (const e of events) {
      if (e.deleted) continue;
      result.push({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        allDay: e.all_day ?? false,
        partners: (e.partners ?? []).map((p) => ({
          id: p.id,
          name: p.name ?? "Unbekannt",
          role: p.role ?? null,
        })),
        projectId: e.project_match?.id ?? null,
        projectRelativeId: e.project_match?.relative_id ?? null,
        projectName: e.project_match?.name ?? null,
      });
    }
    if (events.length === 0) break;
    offset += events.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Book accounts (Kontenplan) — for assigning manual receipts to an account.
// ---------------------------------------------------------------------------

export interface BookAccount {
  /** SKR account number (SKR03, fallback SKR04), as string. */
  number: string;
  name: string;
  type: string | null;
}

/** The company's chart of accounts from HERO. */
export async function getBookAccounts(): Promise<BookAccount[]> {
  const data = await heroGraphQL<{
    bookaccounts: {
      name: string | null;
      type: string | null;
      skr03_number: number | null;
      skr04_number: number | null;
    }[];
  }>(`query BookAccounts { bookaccounts(first: 3000) { name type skr03_number skr04_number } }`);
  return (data.bookaccounts ?? [])
    .map((a) => ({
      number: String(a.skr03_number ?? a.skr04_number ?? ""),
      name: a.name ?? "",
      type: a.type ?? null,
    }))
    .filter((a) => a.number && a.name)
    .sort((a, b) => a.number.localeCompare(b.number, "de", { numeric: true }));
}

// ---------------------------------------------------------------------------
// Stock articles (Lager) — read-only stock from HERO (no write API available).
// Stock materials are nested under supply_product_versions.
// ---------------------------------------------------------------------------

export interface StockArticle {
  id: number;
  name: string;
  itemNumber: string;
  qrId: string | null;
  unit: string;
  category: string | null;
  totalStock: number;
  minStock: number | null;
  targetStock: number | null;
  openConsignment: number;
  openOrder: number;
  /** Einkaufspreis (HERO base_price) – wird gespeichert, aber nicht angezeigt. */
  purchasePrice: number | null;
}

/** All stock materials (articles with stock) from HERO, deduplicated by id. */
export async function getStockArticles(): Promise<StockArticle[]> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byId = new Map<number, StockArticle>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      supply_product_versions: {
        base_price: number | null;
        stock_materials:
          | {
              id: number;
              name: string | null;
              item_number: string | null;
              qr_id: string | null;
              unit_type: string | null;
              category: string | null;
              total_stock: number | null;
              min_stock: number | null;
              target_stock: number | null;
              open_consignment_items_amount: number | null;
              open_order_items_amount: number | null;
            }[]
          | null;
      }[];
    }>(
      `query StockArticles($first: Int, $offset: Int) {
        supply_product_versions(first: $first, offset: $offset) {
          base_price
          stock_materials {
            id
            name
            item_number
            qr_id
            unit_type
            category
            total_stock
            min_stock
            target_stock
            open_consignment_items_amount
            open_order_items_amount
          }
        }
      }`,
      { first: pageSize, offset }
    );
    const versions = data.supply_product_versions ?? [];
    for (const v of versions) {
      for (const s of v.stock_materials ?? []) {
        if (byId.has(s.id)) continue;
        byId.set(s.id, {
          id: s.id,
          name: s.name ?? "—",
          itemNumber: s.item_number ?? "",
          qrId: s.qr_id ?? null,
          unit: s.unit_type ?? "",
          category: s.category ?? null,
          totalStock: s.total_stock ?? 0,
          minStock: s.min_stock ?? null,
          targetStock: s.target_stock ?? null,
          openConsignment: s.open_consignment_items_amount ?? 0,
          openOrder: s.open_order_items_amount ?? 0,
          purchasePrice: v.base_price ?? null,
        });
      }
    }
    if (versions.length === 0) break;
    offset += versions.length;
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// ---------------------------------------------------------------------------
// Absences (Urlaub / Krankheit etc.) — reduce planned capacity.
// ---------------------------------------------------------------------------

export interface AbsenceLite {
  partnerId: number;
  partnerName: string;
  /** e.g. "vacation", "sick", "parental_leave". */
  type: string;
  /** e.g. "approved", "submitted". */
  status: string;
  /** Inclusive start date, yyyy-mm-dd. */
  start: string;
  /** Inclusive end date, yyyy-mm-dd. */
  end: string;
  /** First day is only a half day. */
  startHalf: boolean;
  /** Last day is only a half day. */
  endHalf: boolean;
  /** Employee role (e.g. "worker" = Monteur). */
  partnerRole: string | null;
}

/** Approved/submitted absences overlapping [from, to] (yyyy-mm-dd). */
export async function getAbsences(from: string, to: string): Promise<AbsenceLite[]> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const result: AbsenceLite[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      absences: {
        id: number;
        type: string | null;
        status: string | null;
        start: string | null;
        end: string | null;
        start_budget: string | null;
        end_budget: string | null;
        partner: { id: number; name: string | null; role: string | null } | null;
      }[];
    }>(
      `query Absences($start: Date, $end: Date, $first: Int, $offset: Int) {
        absences(
          show_all_partners: true
          start: $start
          end: $end
          orderBy: "start"
          first: $first
          offset: $offset
        ) {
          id
          type
          status
          start
          end
          start_budget
          end_budget
          partner { id name role }
        }
      }`,
      { start: from, end: to, first: pageSize, offset }
    );
    const absences = data.absences ?? [];
    for (const a of absences) {
      // Only count absences that actually block availability.
      if (a.status !== "approved" && a.status !== "submitted") continue;
      if (!a.start || !a.end || !a.partner) continue;
      result.push({
        partnerId: a.partner.id,
        partnerName: a.partner.name ?? "Unbekannt",
        type: a.type ?? "absence",
        status: a.status,
        start: a.start.slice(0, 10),
        end: a.end.slice(0, 10),
        startHalf: a.start_budget === "half_day",
        endHalf: a.end_budget === "half_day",
        partnerRole: a.partner.role ?? null,
      });
    }
    if (absences.length === 0) break;
    offset += absences.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Working times (Arbeitszeiten = tracking_times)
// ---------------------------------------------------------------------------

export interface TrackingTimeEntry {
  id: number;
  start: string | null;
  end: string | null;
  durationHours: number;
  partnerId: number | null;
  partnerName: string;
  projectId: number | null;
  projectRelativeId: number | null;
  projectName: string | null;
  comment: string;
}

/** All time-tracking entries in [start, end) (yyyy-mm-dd), across all employees. */
export async function getTrackingTimes(start: string, end: string): Promise<TrackingTimeEntry[]> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const result: TrackingTimeEntry[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      tracking_times: {
        id: number;
        start: string | null;
        end: string | null;
        comment: string | null;
        partner: { id: number; name: string | null } | null;
        project_match: { id: number; relative_id: number | null; name: string | null } | null;
      }[];
    }>(
      `query TrackingTimes($start: Date, $end: Date, $first: Int, $offset: Int) {
        tracking_times(
          show_all_partners: true
          start: $start
          end: $end
          orderBy: "start"
          first: $first
          offset: $offset
        ) {
          id
          start
          end
          comment
          partner { id name }
          project_match { id relative_id name }
        }
      }`,
      { start, end, first: pageSize, offset }
    );
    const entries = data.tracking_times ?? [];
    for (const e of entries) {
      const durationMs =
        e.start && e.end ? new Date(e.end).getTime() - new Date(e.start).getTime() : 0;
      result.push({
        id: e.id,
        start: e.start,
        end: e.end,
        durationHours: durationMs > 0 ? Math.round((durationMs / 3_600_000) * 100) / 100 : 0,
        partnerId: e.partner?.id ?? null,
        partnerName: e.partner?.name ?? "Unbekannt",
        projectId: e.project_match?.id ?? null,
        projectRelativeId: e.project_match?.relative_id ?? null,
        projectName: e.project_match?.name ?? null,
        comment: e.comment ?? "",
      });
    }
    if (entries.length === 0) break;
    offset += entries.length;
  }

  return result;
}

/** Total worked hours per project (project_match id), across all time. */
export async function getHoursByProject(): Promise<Map<number, number>> {
  const pageSize = HERO_TRACKING_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byProject = new Map<number, number>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      tracking_times: { project_match_id: number | null; start: string | null; end: string | null }[];
    }>(
      `query HoursByProject($first: Int, $offset: Int) {
        tracking_times(show_all_partners: true, orderBy: "id", first: $first, offset: $offset) {
          project_match_id
          start
          end
        }
      }`,
      { first: pageSize, offset }
    );
    const entries = data.tracking_times ?? [];
    for (const e of entries) {
      if (e.project_match_id == null || !e.start || !e.end) continue;
      const ms = new Date(e.end).getTime() - new Date(e.start).getTime();
      if (ms <= 0) continue;
      byProject.set(e.project_match_id, (byProject.get(e.project_match_id) ?? 0) + ms / 3_600_000);
    }
    if (entries.length === 0) break;
    offset += entries.length;
  }

  for (const [k, v] of byProject) byProject.set(k, Math.round(v * 100) / 100);
  return byProject;
}

export interface HoursByProjectEmployee {
  /** project_match id -> (employee/partner id -> worked hours). */
  byProject: Map<number, Map<number, number>>;
  /** employee/partner id -> display name. */
  names: Map<number, string>;
}

/** Worked hours per project AND employee (all time), for profit allocation. */
export async function getHoursByProjectAndEmployee(): Promise<HoursByProjectEmployee> {
  const pageSize = HERO_TRACKING_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byProject = new Map<number, Map<number, number>>();
  const names = new Map<number, string>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      tracking_times: {
        project_match_id: number | null;
        start: string | null;
        end: string | null;
        partner: { id: number; name: string | null } | null;
      }[];
    }>(
      `query HoursByProjectEmp($first: Int, $offset: Int) {
        tracking_times(show_all_partners: true, orderBy: "id", first: $first, offset: $offset) {
          project_match_id
          start
          end
          partner { id name }
        }
      }`,
      { first: pageSize, offset }
    );
    const entries = data.tracking_times ?? [];
    for (const e of entries) {
      if (e.project_match_id == null || e.partner?.id == null || !e.start || !e.end) continue;
      const ms = new Date(e.end).getTime() - new Date(e.start).getTime();
      if (ms <= 0) continue;
      const hours = ms / 3_600_000;
      names.set(e.partner.id, e.partner.name ?? "Unbekannt");
      const emp = byProject.get(e.project_match_id) ?? new Map<number, number>();
      emp.set(e.partner.id, (emp.get(e.partner.id) ?? 0) + hours);
      byProject.set(e.project_match_id, emp);
    }
    if (entries.length === 0) break;
    offset += entries.length;
  }

  for (const emp of byProject.values()) {
    for (const [k, v] of emp) emp.set(k, Math.round(v * 100) / 100);
  }
  return { byProject, names };
}

export interface ProjectHourDetail {
  hours: number;
  /** Mitarbeiter mit erfassten Stunden, absteigend nach Stunden. */
  employees: { name: string; hours: number }[];
  /** Erste/letzte Erfassung (yyyy-mm-dd) und Anzahl Buchungen. */
  firstDate: string | null;
  lastDate: string | null;
  entries: number;
}

/** Stundendetails je Projekt: Summe, Mitarbeiter und Erfassungszeitraum (für Workflows). */
export async function getProjectHourDetails(): Promise<Map<number, ProjectHourDetail>> {
  const pageSize = HERO_TRACKING_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const acc = new Map<
    number,
    { hours: number; emp: Map<string, number>; first: string | null; last: string | null; entries: number }
  >();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      tracking_times: {
        project_match_id: number | null;
        start: string | null;
        end: string | null;
        partner: { id: number; name: string | null } | null;
      }[];
    }>(
      `query HoursDetail($first: Int, $offset: Int) {
        tracking_times(show_all_partners: true, orderBy: "id", first: $first, offset: $offset) {
          project_match_id
          start
          end
          partner { id name }
        }
      }`,
      { first: pageSize, offset }
    );
    const entries = data.tracking_times ?? [];
    for (const e of entries) {
      if (e.project_match_id == null || !e.start || !e.end) continue;
      const ms = new Date(e.end).getTime() - new Date(e.start).getTime();
      if (ms <= 0) continue;
      const hours = ms / 3_600_000;
      const day = e.start.slice(0, 10);
      const cur =
        acc.get(e.project_match_id) ??
        { hours: 0, emp: new Map<string, number>(), first: null, last: null, entries: 0 };
      cur.hours += hours;
      cur.entries += 1;
      const name = e.partner?.name ?? "Unbekannt";
      cur.emp.set(name, (cur.emp.get(name) ?? 0) + hours);
      if (!cur.first || day < cur.first) cur.first = day;
      if (!cur.last || day > cur.last) cur.last = day;
      acc.set(e.project_match_id, cur);
    }
    if (entries.length === 0) break;
    offset += entries.length;
  }

  const out = new Map<number, ProjectHourDetail>();
  for (const [pid, v] of acc) {
    out.set(pid, {
      hours: Math.round(v.hours * 100) / 100,
      employees: Array.from(v.emp.entries())
        .map(([name, h]) => ({ name, hours: Math.round(h * 100) / 100 }))
        .sort((a, b) => b.hours - a.hours),
      firstDate: v.first,
      lastDate: v.last,
      entries: v.entries,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project pipeline — projects grouped by their current status phase.
// Phases (by status_code): 201 Neu-Erstkontakt, 601 Angebotserstellung,
// 801 Auftragsvergabe, 1111 In Umsetzung, 1150 Kundenrechnung,
// 1201 Schlussrechnung, 2000 Abgeschlossen.
// ---------------------------------------------------------------------------

export interface PipelineProjectRef {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
  /** Net sum of this project's offers (Angebote). */
  offerSum: number;
  /** Date the offer was sent (latest "Versendet"), yyyy-mm-dd or null. */
  offerDate: string | null;
}

export interface PipelineStage {
  key: string;
  /** Detailed step name (e.g. "🔓 Angebot offen"). */
  label: string;
  /** Parent phase code (status_code) and name. */
  phaseCode: number;
  phaseName: string;
  count: number;
  projects: PipelineProjectRef[];
}

export interface ProjectPipeline {
  stages: PipelineStage[];
  total: number;
  withoutStatus: number;
}

export async function getProjectPipeline(): Promise<ProjectPipeline> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byStep = new Map<
    string,
    {
      label: string;
      phaseCode: number;
      phaseName: string;
      sortOrder: number;
      projects: PipelineProjectRef[];
    }
  >();
  let total = 0;
  let withoutStatus = 0;

  const offerByProject = await getOfferInfoByProject();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      project_matches: {
        id: number;
        relative_id: number | null;
        name: string | null;
        customer: { company_name: string | null; full_name: string | null } | null;
        current_project_match_status: {
          status_code: number | null;
          name: string | null;
          step: { id: number; name: string | null; sort_order: number | null } | null;
        } | null;
      }[];
    }>(
      `query Pipeline($first: Int, $offset: Int) {
        project_matches(type: "project", orderBy: "id", first: $first, offset: $offset) {
          id
          relative_id
          name
          customer { company_name full_name }
          current_project_match_status {
            status_code
            name
            step { id name sort_order }
          }
        }
      }`,
      { first: pageSize, offset }
    );
    const matches = data.project_matches ?? [];
    for (const m of matches) {
      total++;
      const s = m.current_project_match_status;
      if (!s || s.status_code == null) {
        withoutStatus++;
        continue;
      }
      const phaseCode = s.status_code;
      const phaseName = s.name ?? `Status ${s.status_code}`;
      const key = s.step ? `step-${s.step.id}` : `phase-${phaseCode}`;
      const label = s.step?.name || phaseName;
      const sortOrder = s.step?.sort_order ?? phaseCode;
      const entry =
        byStep.get(key) ?? { label, phaseCode, phaseName, sortOrder, projects: [] };
      entry.projects.push({
        id: m.id,
        relativeId: m.relative_id,
        name: m.name ?? `Projekt #${m.id}`,
        customerName: m.customer
          ? m.customer.company_name || m.customer.full_name || null
          : null,
        offerSum: offerByProject.get(m.id)?.sum ?? 0,
        offerDate: offerByProject.get(m.id)?.sentDate ?? null,
      });
      byStep.set(key, entry);
    }
    if (matches.length === 0) break;
    offset += matches.length;
  }

  const stages: PipelineStage[] = [...byStep.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      phaseCode: v.phaseCode,
      phaseName: v.phaseName,
      count: v.projects.length,
      projects: v.projects,
      sortOrder: v.sortOrder,
    }))
    .sort((a, b) => a.phaseCode - b.phaseCode || a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...rest }) => rest);

  return { stages, total, withoutStatus };
}

// ---------------------------------------------------------------------------
// Projects (project_matches)
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
  status: string | null;
}

interface RawProjectMatch {
  id: number;
  relative_id: number | null;
  name: string | null;
  customer: { company_name: string | null; full_name: string | null } | null;
  current_project_match_status: {
    name: string | null;
    step: { name: string | null } | null;
  } | null;
}

const PROJECTS_QUERY = `
  query Projects($first: Int, $offset: Int) {
    project_matches(type: "project", orderBy: "id", first: $first, offset: $offset) {
      id
      relative_id
      name
      customer { company_name full_name }
      current_project_match_status {
        name
        step { name }
      }
    }
  }
`;

/** Status code of the "Abgeschlossen" project phase. */
const PROJECT_DONE_STATUS_CODE = 2000;

/**
 * Ids of projects relevant for the profit evaluation in `year`: projects whose
 * current status is "Abgeschlossen" OR whose current step is "Nachkalkulation",
 * and that entered that status in `year`.
 */
export async function getEvaluableProjectIds(year: number): Promise<Set<number>> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const ids = new Set<number>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      project_matches: {
        id: number;
        current_project_match_status: {
          status_code: number | null;
          created: string | null;
          modified: string | null;
          step: { name: string | null } | null;
        } | null;
      }[];
    }>(
      `query EvaluableProjects($first: Int, $offset: Int) {
        project_matches(type: "project", orderBy: "id", first: $first, offset: $offset) {
          id
          current_project_match_status { status_code created modified step { name } }
        }
      }`,
      { first: pageSize, offset }
    );
    const rows = data.project_matches ?? [];
    for (const p of rows) {
      const st = p.current_project_match_status;
      if (!st) continue;
      const isDone = st.status_code === PROJECT_DONE_STATUS_CODE;
      const isNachkalkulation = (st.step?.name ?? "").toLowerCase().includes("nachkalkulation");
      if (!isDone && !isNachkalkulation) continue;
      const date = st.created || st.modified;
      if (date && new Date(date).getUTCFullYear() === year) ids.add(p.id);
    }
    if (rows.length === 0) break;
    offset += rows.length;
  }
  return ids;
}

// Document type "Auftragsbestätigung" = 1057579, "Angebot" = 1057591.
const CONFIRMATION_DOCUMENT_TYPE_ID = 1057579;
const OFFER_DOCUMENT_TYPE_ID = 1057591;
const RECHNUNG_DOCUMENT_TYPE_ID = 1057585; // Gutschrift 1057587 + Storno 1057595 reduce the total.

export interface DocumentVolume {
  /** Net sum of offers (Angebote) for the year. */
  offers: number;
  /** Net sum of order confirmations (Auftragsbestätigungen) for the year. */
  confirmations: number;
  /** Net sum already invoiced (Rechnungen − Gutschriften − Stornos) for the year. */
  invoiced: number;
}

const GUTSCHRIFT_DOCUMENT_TYPE_ID = 1057587;
const STORNO_DOCUMENT_TYPE_ID = 1057595;

/** Net volume of offers, order confirmations and invoiced amount for a year (excludes deleted). */
export async function getOfferConfirmationVolume(year: number): Promise<DocumentVolume> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  let offers = 0;
  let confirmations = 0;
  let invoiced = 0;

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      customer_documents: {
        document_type_id: number | null;
        value: number | null;
        status_code: number | null;
        date: string | null;
      }[];
    }>(
      `query Volume($ids: [Int], $first: Int, $offset: Int) {
        customer_documents(document_type_ids: $ids, orderBy: "id", first: $first, offset: $offset) {
          document_type_id
          value
          status_code
          date
        }
      }`,
      {
        ids: [
          OFFER_DOCUMENT_TYPE_ID,
          CONFIRMATION_DOCUMENT_TYPE_ID,
          RECHNUNG_DOCUMENT_TYPE_ID,
          GUTSCHRIFT_DOCUMENT_TYPE_ID,
          STORNO_DOCUMENT_TYPE_ID,
        ],
        first: pageSize,
        offset,
      }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || !d.date) continue;
      if (new Date(d.date).getUTCFullYear() !== year) continue;
      const value = d.value ?? 0;
      switch (d.document_type_id) {
        case OFFER_DOCUMENT_TYPE_ID:
          offers += value;
          break;
        case CONFIRMATION_DOCUMENT_TYPE_ID:
          confirmations += value;
          break;
        case RECHNUNG_DOCUMENT_TYPE_ID:
          invoiced += value;
          break;
        case GUTSCHRIFT_DOCUMENT_TYPE_ID:
        case STORNO_DOCUMENT_TYPE_ID:
          invoiced -= Math.abs(value);
          break;
      }
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  return {
    offers: Math.round(offers * 100) / 100,
    confirmations: Math.round(confirmations * 100) / 100,
    invoiced: Math.round(invoiced * 100) / 100,
  };
}

/** Monthly net sums (index 0 = January) of offers and order confirmations for a year. */
export async function getOfferConfirmationByMonth(
  year: number
): Promise<{ offers: number[]; confirmations: number[] }> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const offers = new Array(12).fill(0);
  const confirmations = new Array(12).fill(0);

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      customer_documents: {
        document_type_id: number | null;
        value: number | null;
        status_code: number | null;
        date: string | null;
      }[];
    }>(
      `query VolumeMonthly($ids: [Int], $first: Int, $offset: Int) {
        customer_documents(document_type_ids: $ids, orderBy: "id", first: $first, offset: $offset) {
          document_type_id
          value
          status_code
          date
        }
      }`,
      {
        ids: [OFFER_DOCUMENT_TYPE_ID, CONFIRMATION_DOCUMENT_TYPE_ID],
        first: pageSize,
        offset,
      }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || !d.date) continue;
      const dt = new Date(d.date);
      if (dt.getUTCFullYear() !== year) continue;
      const m = dt.getUTCMonth();
      const value = d.value ?? 0;
      if (d.document_type_id === OFFER_DOCUMENT_TYPE_ID) offers[m] += value;
      else if (d.document_type_id === CONFIRMATION_DOCUMENT_TYPE_ID) confirmations[m] += value;
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return { offers: offers.map(round2), confirmations: confirmations.map(round2) };
}

export interface OfferInfo {
  /** Net sum of the project's offers. */
  sum: number;
  /** Date the offer was sent (latest offer with status "Versendet"), yyyy-mm-dd. */
  sentDate: string | null;
}

/** Offer net sum and latest send date per project_match id (excludes deleted). */
export async function getOfferInfoByProject(): Promise<Map<number, OfferInfo>> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byProject = new Map<number, OfferInfo>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      customer_documents: {
        project_match_id: number | null;
        value: number | null;
        status_code: number | null;
        date: string | null;
      }[];
    }>(
      `query OfferInfo($ids: [Int], $first: Int, $offset: Int) {
        customer_documents(document_type_ids: $ids, orderBy: "id", first: $first, offset: $offset) {
          project_match_id
          value
          status_code
          date
        }
      }`,
      { ids: [OFFER_DOCUMENT_TYPE_ID], first: pageSize, offset }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || d.project_match_id == null) continue;
      const entry = byProject.get(d.project_match_id) ?? { sum: 0, sentDate: null };
      entry.sum += d.value ?? 0;
      // status 200 = "Versendet"; keep the latest send date.
      if (d.status_code === 200 && d.date && (!entry.sentDate || d.date > entry.sentDate)) {
        entry.sentDate = d.date;
      }
      byProject.set(d.project_match_id, entry);
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  for (const [k, v] of byProject) byProject.set(k, { ...v, sum: Math.round(v.sum * 100) / 100 });
  return byProject;
}

/**
 * Net invoiced amount per project: Rechnung (+) minus Gutschrift and
 * Stornorechnung (each subtracted by magnitude), deleted documents excluded.
 */
export async function getInvoiceNetByProject(): Promise<Map<number, number>> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byProject = new Map<number, number>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      customer_documents: {
        document_type_id: number | null;
        project_match_id: number | null;
        value: number | null;
        status_code: number | null;
      }[];
    }>(
      `query InvoiceNet($ids: [Int], $first: Int, $offset: Int) {
        customer_documents(document_type_ids: $ids, orderBy: "id", first: $first, offset: $offset) {
          document_type_id
          project_match_id
          value
          status_code
        }
      }`,
      { ids: INVOICE_DOCUMENT_TYPE_IDS, first: pageSize, offset }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || d.project_match_id == null) continue;
      const value = d.value ?? 0;
      const contribution =
        d.document_type_id === RECHNUNG_DOCUMENT_TYPE_ID ? value : -Math.abs(value);
      byProject.set(d.project_match_id, (byProject.get(d.project_match_id) ?? 0) + contribution);
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  for (const [k, v] of byProject) byProject.set(k, Math.round(v * 100) / 100);
  return byProject;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Recursively walks a draft data tree summing planned minutes (product
 * line items, `time_minutes`) and material cost (`SupplyProduct` positions,
 * `base_price` × `quantity` — base_price is the purchase price / EK).
 */
function sumDraft(
  node: unknown,
  acc: { minutes: number; material: number; laborCost: number },
  // Menge der umschließenden Position (SupplyService), mit der die Material-
  // menge (SupplyProduct.quantity = Menge je Positionseinheit) multipliziert wird.
  serviceQty = 1
): void {
  if (Array.isArray(node)) {
    for (const n of node) sumDraft(n, acc, serviceQty);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.type === "product" && typeof obj.time_minutes === "number") {
      acc.minutes += obj.time_minutes;
    }
    if (obj.atType === "SupplyProduct") {
      acc.material += toNumber(obj.base_price) * toNumber(obj.quantity) * serviceQty;
    }
    // SupplyService.wage_base = planned labor cost (Kostenlohn) of that line.
    if (obj.atType === "SupplyService") {
      acc.laborCost += toNumber(obj.wage_base);
    }
    // In eine SupplyService-Position wird deren Menge als Multiplikator vererbt.
    const childQty = obj.atType === "SupplyService" ? toNumber(obj.quantity) || 1 : serviceQty;
    for (const v of Object.values(obj)) sumDraft(v, acc, childQty);
  }
}

export interface ProjectCalculation {
  /** Planned hours. */
  hours: number;
  /** Planned material cost (purchase price / EK). */
  material: number;
  /** Planned labor cost (Soll-Lohnkosten). */
  laborCost: number;
}

/** Calculated (planned) hours and material cost per project, from the Auftragsbestätigung drafts. */
export async function getCalculatedByProject(): Promise<Map<number, ProjectCalculation>> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byProject = new Map<number, ProjectCalculation>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      customer_documents: {
        project_match_id: number | null;
        status_code: number | null;
        published_customer_document_draft: { data: unknown } | null;
      }[];
    }>(
      `query CalcByProject($ids: [Int], $first: Int, $offset: Int) {
        customer_documents(document_type_ids: $ids, orderBy: "id", first: $first, offset: $offset) {
          project_match_id
          status_code
          published_customer_document_draft { data }
        }
      }`,
      { ids: [CONFIRMATION_DOCUMENT_TYPE_ID], first: pageSize, offset }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || d.project_match_id == null) continue;
      const raw = d.published_customer_document_draft?.data;
      if (raw == null) continue;
      let json: unknown;
      try {
        json = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      const acc = { minutes: 0, material: 0, laborCost: 0 };
      sumDraft(json, acc);
      const cur = byProject.get(d.project_match_id) ?? { hours: 0, material: 0, laborCost: 0 };
      cur.hours += acc.minutes / 60;
      cur.material += acc.material;
      cur.laborCost += acc.laborCost;
      byProject.set(d.project_match_id, cur);
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  for (const [k, v] of byProject) {
    byProject.set(k, {
      hours: Math.round(v.hours * 100) / 100,
      material: Math.round(v.material * 100) / 100,
      laborCost: Math.round(v.laborCost * 100) / 100,
    });
  }
  return byProject;
}

/** Calculated (planned) labor hours for a single project, from its Auftragsbestätigung drafts. */
export async function getCalculatedHoursForProject(projectMatchId: number): Promise<number> {
  const data = await heroGraphQL<{
    customer_documents: {
      status_code: number | null;
      published_customer_document_draft: { data: unknown } | null;
    }[];
  }>(
    `query CalcHoursForProject($pids: [Int], $ids: [Int]) {
      customer_documents(project_match_ids: $pids, document_type_ids: $ids, orderBy: "id", first: 100) {
        status_code
        published_customer_document_draft { data }
      }
    }`,
    { pids: [projectMatchId], ids: [CONFIRMATION_DOCUMENT_TYPE_ID] }
  );

  let minutes = 0;
  for (const d of data.customer_documents ?? []) {
    if (d.status_code === 1000) continue; // deleted
    const raw = d.published_customer_document_draft?.data;
    if (raw == null) continue;
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    const acc = { minutes: 0, material: 0, laborCost: 0 };
    sumDraft(json, acc);
    minutes += acc.minutes;
  }
  return Math.round((minutes / 60) * 100) / 100;
}

/** Eine kalkulierte Materialposition (aus dem Auftragsbestätigungs-Entwurf). */
export interface CalculatedMaterialItem {
  name: string;
  quantity: number;
  /** Einheit (unit_type), z. B. "Stk", "m²". */
  unit: string | null;
  /** Einkaufspreis je Einheit (base_price / EK). */
  ekPrice: number;
  /** quantity × ekPrice. */
  lineTotal: number;
  manufacturer: string | null;
  articleNr: string | null;
}

export interface ProjectMaterialCalculation {
  hours: number;
  /** Summe Material-EK (Soll). */
  materialTotal: number;
  laborCost: number;
  items: CalculatedMaterialItem[];
}

/** Sammelt Materialpositionen (SupplyProduct) + geplante Minuten/Lohnkosten aus einem Entwurfsbaum. */
function collectDraft(
  node: unknown,
  acc: { minutes: number; laborCost: number; items: CalculatedMaterialItem[] },
  serviceQty = 1
): void {
  if (Array.isArray(node)) {
    for (const n of node) collectDraft(n, acc, serviceQty);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.type === "product" && typeof obj.time_minutes === "number") {
      acc.minutes += obj.time_minutes;
    }
    if (obj.atType === "SupplyProduct") {
      // Effektive Menge = Menge je Positionseinheit × Positionsmenge (SupplyService).
      const quantity = toNumber(obj.quantity) * serviceQty;
      const ekPrice = toNumber(obj.base_price);
      acc.items.push({
        name: String(obj.name ?? obj.description ?? "Unbenannt"),
        quantity,
        unit: obj.unit_type != null ? String(obj.unit_type) : null,
        ekPrice,
        lineTotal: Math.round(quantity * ekPrice * 100) / 100,
        manufacturer: obj.manufacturer != null ? String(obj.manufacturer) : null,
        articleNr: obj.nr != null ? String(obj.nr) : obj.itemNumber != null ? String(obj.itemNumber) : null,
      });
    }
    if (obj.atType === "SupplyService") {
      acc.laborCost += toNumber(obj.wage_base);
    }
    const childQty = obj.atType === "SupplyService" ? toNumber(obj.quantity) || 1 : serviceQty;
    for (const v of Object.values(obj)) collectDraft(v, acc, childQty);
  }
}

/**
 * Kalkulierte Materialpositionen (welches Material, Menge, EK) eines Projekts
 * aus den Auftragsbestätigungs-Entwürfen. Gleiche Artikel werden zusammengefasst.
 */
export async function getCalculatedMaterialsForProject(
  projectMatchId: number
): Promise<ProjectMaterialCalculation> {
  const data = await heroGraphQL<{
    customer_documents: {
      status_code: number | null;
      published_customer_document_draft: { data: unknown } | null;
    }[];
  }>(
    `query CalcMaterialsForProject($pids: [Int], $ids: [Int]) {
      customer_documents(project_match_ids: $pids, document_type_ids: $ids, orderBy: "id", first: 100) {
        status_code
        published_customer_document_draft { data }
      }
    }`,
    { pids: [projectMatchId], ids: [CONFIRMATION_DOCUMENT_TYPE_ID] }
  );

  const acc = { minutes: 0, laborCost: 0, items: [] as CalculatedMaterialItem[] };
  for (const d of data.customer_documents ?? []) {
    if (d.status_code === 1000) continue; // gelöscht
    const raw = d.published_customer_document_draft?.data;
    if (raw == null) continue;
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    collectDraft(json, acc);
  }

  // Gleiche Artikel (Name + EK) zusammenfassen.
  const merged = new Map<string, CalculatedMaterialItem>();
  for (const it of acc.items) {
    const key = `${it.name}|${it.ekPrice}`;
    const cur = merged.get(key);
    if (cur) {
      cur.quantity = Math.round((cur.quantity + it.quantity) * 1000) / 1000;
      cur.lineTotal = Math.round((cur.lineTotal + it.lineTotal) * 100) / 100;
    } else {
      merged.set(key, { ...it });
    }
  }
  const items = [...merged.values()].sort((a, b) => b.lineTotal - a.lineTotal);
  const materialTotal = Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;

  return {
    hours: Math.round((acc.minutes / 60) * 100) / 100,
    materialTotal,
    laborCost: Math.round(acc.laborCost * 100) / 100,
    items,
  };
}

/** Net sum of order confirmations (Auftragsbestätigungen) per project_match id. */
export interface ConfirmationInfo {
  net: number;
  /** Latest Auftragsbestätigung date, yyyy-mm-dd. */
  date: string | null;
}

export async function getConfirmationNetByProject(): Promise<Map<number, ConfirmationInfo>> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const byProject = new Map<number, ConfirmationInfo>();

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{
      customer_documents: {
        project_match_id: number | null;
        value: number | null;
        status_code: number | null;
        date: string | null;
      }[];
    }>(
      `query Confirmations($ids: [Int], $first: Int, $offset: Int) {
        customer_documents(document_type_ids: $ids, orderBy: "id", first: $first, offset: $offset) {
          project_match_id
          value
          status_code
          date
        }
      }`,
      { ids: [CONFIRMATION_DOCUMENT_TYPE_ID], first: pageSize, offset }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || d.project_match_id == null) continue; // skip deleted / unlinked
      const entry = byProject.get(d.project_match_id) ?? { net: 0, date: null };
      entry.net += d.value ?? 0;
      if (d.date && (!entry.date || d.date > entry.date)) entry.date = d.date;
      byProject.set(d.project_match_id, entry);
    }
    if (docs.length === 0) break;
    offset += docs.length;
  }

  for (const [k, v] of byProject) byProject.set(k, { ...v, net: Math.round(v.net * 100) / 100 });
  return byProject;
}

/** Fetches all projects (project_matches of type "project"), paginated. */
export async function getProjects(): Promise<ProjectSummary[]> {
  const pageSize = HERO_PAGE_SIZE;
  const maxPages = HERO_MAX_PAGES;
  const result: ProjectSummary[] = [];

  for (let guard = 0, offset = 0; guard < maxPages; guard++) {
    const data = await heroGraphQL<{ project_matches: RawProjectMatch[] }>(PROJECTS_QUERY, {
      first: pageSize,
      offset,
    });
    const matches = data.project_matches ?? [];
    for (const p of matches) {
      const status = p.current_project_match_status;
      result.push({
        id: p.id,
        relativeId: p.relative_id,
        name: p.name ?? "",
        customerName: p.customer
          ? p.customer.company_name || p.customer.full_name || null
          : null,
        status: status ? status.step?.name || status.name || null : null,
      });
    }
    if (matches.length === 0) break;
    offset += matches.length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Baustellen-Dokumentation: Fotos zu einem HERO-Projekt (FileUpload-System).
// ---------------------------------------------------------------------------

export interface ProjectPhoto {
  id: number;
  filename: string;
  created: string | null;
  size: number | null;
  /** Signierte Vorschau-URL (Thumbnail) aus HEROs Cloud – kein Speicher bei uns. */
  thumbUrl: string;
  /** Signierte URL zum Originalbild. */
  fullUrl: string;
  /** Name der Person, die das Foto hochgeladen hat (aus der Projekt-Historie). */
  uploaderName: string | null;
}

interface RawHistory {
  user: {
    email: string | null;
    partner: { full_name: string | null; first_name: string | null; last_name: string | null } | null;
    employee: { first_name: string | null; last_name: string | null } | null;
  } | null;
  additional_file_uploads: { id: number }[] | null;
}

interface RawFileUpload {
  id: number;
  filename: string | null;
  image_category: string | null;
  type: string | null;
  size: number | null;
  created: string | null;
  temporary_url: string | null;
  thumbnails: { format: string | null; url: string | null }[] | null;
}

/** Findet ein Projekt anhand seiner Projektnummer (z. B. "PRJ-199"). */
export async function findProjectByNr(
  nr: string
): Promise<{ projectMatchId: number; name: string; projectNr: string } | null> {
  const clean = nr.trim();
  if (!clean) return null;
  const data = await heroGraphQL<{
    project_matches: { id: number; project_nr: string | null; name: string | null }[] | null;
  }>(
    `query ($s: String) {
      project_matches(search: $s, type: "project", first: 25) {
        id
        project_nr
        name
      }
    }`,
    { s: clean }
  );
  const list = data.project_matches ?? [];
  const match =
    list.find((p) => (p.project_nr ?? "").toLowerCase() === clean.toLowerCase()) ??
    list.find((p) => (p.project_nr ?? "").toLowerCase().includes(clean.toLowerCase()));
  if (!match) return null;
  return { projectMatchId: match.id, name: match.name ?? "", projectNr: match.project_nr ?? clean };
}

/** Lädt die Fotos eines Projekts aus der angegebenen Bild-Kategorie (Live aus HERO). */
export async function getProjectPhotos(
  projectMatchId: number,
  imageCategory: string
): Promise<ProjectPhoto[]> {
  const data = await heroGraphQL<{
    project_matches: { file_uploads: RawFileUpload[] | null; histories: RawHistory[] | null }[] | null;
  }>(
    `query ($ids: [Int]) {
      project_matches(ids: $ids) {
        file_uploads(is_deleted: false, first: 1000) {
          id
          filename
          image_category
          type
          size
          created
          temporary_url(expires: 3600)
          thumbnails(formats: [fit_512]) { format url }
        }
        histories(orderBy: "id", last: 400) {
          user {
            email
            partner { full_name first_name last_name }
            employee { first_name last_name }
          }
          additional_file_uploads { id }
        }
      }
    }`,
    { ids: [projectMatchId] }
  );
  const pm = data.project_matches?.[0];
  const uploads = pm?.file_uploads ?? [];

  // Uploader je Datei aus der Historie ableiten (file_upload_id -> Personenname).
  const uploaderById = new Map<number, string>();
  for (const h of pm?.histories ?? []) {
    const p = h.user?.partner;
    const emp = h.user?.employee;
    const name =
      p?.full_name?.trim() ||
      [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() ||
      [emp?.first_name, emp?.last_name].filter(Boolean).join(" ").trim() ||
      h.user?.email?.trim() ||
      "";
    if (!name) continue;
    for (const f of h.additional_file_uploads ?? []) {
      if (!uploaderById.has(f.id)) uploaderById.set(f.id, name);
    }
  }

  return uploads
    .filter((u) => (u.image_category ?? "") === imageCategory && u.temporary_url)
    .map((u) => {
      const thumb = u.thumbnails?.find((t) => t.url)?.url ?? u.temporary_url!;
      return {
        id: u.id,
        filename: u.filename ?? `Foto ${u.id}`,
        created: u.created ?? null,
        size: u.size ?? null,
        thumbUrl: thumb,
        fullUrl: u.temporary_url!,
        uploaderName: uploaderById.get(u.id) ?? null,
      };
    })
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
}

/** Ein an einem bestimmten Tag hochgeladenes Projekt-Foto (für den Tagesbericht). */
export interface DailyPhoto {
  id: number;
  filename: string;
  /** Kleines Thumbnail (fit_256) – wird für die Mail serverseitig geladen. */
  thumbUrl: string;
  /** ISO-Uploadzeit. */
  created: string | null;
}

/**
 * Bild-Uploads EINES Projekts, die an einem bestimmten Tag (YYYY-MM-DD, lokale HERO-
 * Zeit) hochgeladen wurden – über alle Bild-Kategorien. Für die Tages-Aktivitätsliste
 * im Bericht. Filtert clientseitig auf das `created`-Datum (HERO hat keinen Datumsfilter
 * auf file_uploads).
 */
export async function getProjectPhotosUploadedOn(
  projectMatchId: number,
  dayIso: string
): Promise<DailyPhoto[]> {
  const data = await heroGraphQL<{
    project_matches: { file_uploads: RawFileUpload[] | null }[] | null;
  }>(
    `query ($ids: [Int]) {
      project_matches(ids: $ids) {
        file_uploads(is_deleted: false, first: 1000, orderBy: "id") {
          id
          filename
          type
          created
          thumbnails(formats: [fit_256]) { format url }
        }
      }
    }`,
    { ids: [projectMatchId] }
  );
  const uploads = data.project_matches?.[0]?.file_uploads ?? [];
  return uploads
    .filter(
      (u) =>
        (u.type ?? "").startsWith("image/") &&
        (u.created ?? "").slice(0, 10) === dayIso &&
        u.thumbnails?.some((t) => t.url)
    )
    .map((u) => ({
      id: u.id,
      filename: u.filename ?? `Foto ${u.id}`,
      thumbUrl: u.thumbnails!.find((t) => t.url)!.url as string,
      created: u.created ?? null,
    }))
    .sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""));
}

/** REST-Upload-Endpoint von HERO (nicht Teil der GraphQL-API, aber mit demselben Bearer-Token nutzbar). */
const HERO_UPLOAD_ENDPOINT = "https://login.hero-software.de/FileUploads/ajax_upload";

interface AjaxUploadResponse {
  status?: string;
  data?: { id?: number; uuid?: string };
}

/**
 * Lädt ein Foto nach HERO hoch und hängt es an ein Projekt.
 *
 * Drei Schritte, alle drei nötig:
 *  1. Datei an den REST-Endpoint posten. WICHTIG: ohne `section`/`category` posten –
 *     HERO legt sie dann als `temp` ab. Setzt man `section` hier schon selbst, meldet
 *     `upload_image` in Schritt 2 zwar Erfolg, verknüpft die Datei aber NICHT mit dem
 *     Projekt (sie liegt dann unauffindbar in HERO herum).
 *  2. `upload_image` verschiebt die temporäre Datei zum Projekt und verlinkt sie.
 *  3. `update_file_upload` setzt die Bild-Kategorie (z. B. "Dokumentation"), damit das
 *     Foto im richtigen Ordner der Galerie auftaucht.
 */
export async function uploadProjectPhoto(
  projectMatchId: number,
  imageCategory: string,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<number> {
  // 1. Datei als temporären Upload hochladen → liefert die uuid.
  const uuid = await heroTempUpload(file);

  // 2. Temporäre Datei dem Projekt zuordnen.
  const linked = await heroGraphQL<{ upload_image: { id: number } | null }>(
    `mutation ($uuid: String!, $target: Int!) {
      upload_image(file_upload_uuid: $uuid, target: project_match, target_id: $target) {
        id
      }
    }`,
    { uuid, target: projectMatchId }
  );
  const fileId = linked.upload_image?.id;
  if (!fileId) throw new Error("Foto konnte nicht mit dem Projekt verknüpft werden.");

  // 3. Bild-Kategorie setzen, damit das Foto im richtigen Ordner erscheint.
  await heroGraphQL(
    `mutation ($id: Int!, $category: String!) {
      update_file_upload(id: $id, image_category: $category) {
        id
      }
    }`,
    { id: fileId, category: imageCategory }
  );

  return fileId;
}

/** Lädt eine Datei als temporären Upload zu HERO hoch und liefert deren uuid. */
async function heroTempUpload(file: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<string> {
  const token = await currentHeroToken();
  if (!token) throw new Error("HERO_API_TOKEN is not configured");

  const form = new FormData();
  // Bewusst ohne section/category: HERO legt die Datei dann als "temp" ab. Nur so
  // ordnen upload_image/upload_document sie danach korrekt zu (siehe uploadProjectPhoto).
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(HERO_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HERO-Upload fehlgeschlagen (HTTP ${res.status}).`);

  const uploaded = (await res.json()) as AjaxUploadResponse;
  const uuid = uploaded.data?.uuid;
  if (!uuid) throw new Error("HERO hat keine Datei-UUID zurückgegeben.");
  return uuid;
}

/** Ein Dokumenten-Ordner aus HERO (z. B. "Angebote", "Schriftverkehr"). */
export interface HeroFolder {
  id: number;
  name: string;
}

/** Alle (nicht gelöschten) Dokumenten-Ordner aus HERO – die Ordnerstruktur der Projektakte. */
export async function getFileUploadFolders(): Promise<HeroFolder[]> {
  const data = await heroGraphQL<{
    file_upload_folders: { id: number; name: string | null; is_deleted: boolean | null }[] | null;
  }>(
    `query {
      file_upload_folders(first: 200) {
        id
        name
        is_deleted
      }
    }`
  );
  return (data.file_upload_folders ?? [])
    .filter((f) => !f.is_deleted && f.name)
    .map((f) => ({ id: f.id, name: f.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * Die Dokumenttyp-ID für "Allgemein" (base_type "generic"). `upload_document`
 * verlangt zwingend eine `document_type_id`; der Ordner wird davon unabhängig
 * gewählt. Wird pro Prozess gecacht (ändert sich praktisch nie).
 */
let genericDocumentTypeId: number | null = null;

export async function getGenericDocumentTypeId(): Promise<number> {
  if (genericDocumentTypeId !== null) return genericDocumentTypeId;

  const data = await heroGraphQL<{
    document_types: { id: number; base_type: string | null; is_active: boolean | null }[] | null;
  }>(
    `query {
      document_types(first: 100) {
        id
        base_type
        is_active
      }
    }`
  );
  const generic = (data.document_types ?? []).find((t) => t.base_type === "generic" && t.is_active);
  if (!generic) throw new Error('In HERO existiert kein Dokumenttyp "Allgemein" (base_type generic).');

  genericDocumentTypeId = generic.id;
  return generic.id;
}

/**
 * Lädt ein Dokument nach HERO hoch und legt es im gewählten Ordner der Projektakte ab.
 *
 * Anders als Fotos (uploadProjectPhoto) läuft das über `upload_document`: Der Ordner
 * hängt in HERO nicht an der Datei, sondern am zugehörigen CustomerDocument
 * (`file_upload_folder_id`). `document_type_id` ist Pflicht – ohne sie schlägt die
 * Mutation mit "Validation failed" fehl.
 *
 * Achtung: So hochgeladene Dokumente erscheinen NICHT in `project_matches.file_uploads`,
 * sondern nur über `customer_documents` – deshalb liest getProjectDocuments beide Quellen.
 */
export async function uploadProjectDocument(
  projectMatchId: number,
  folderId: number,
  file: { buffer: Buffer; filename: string; mime: string }
): Promise<number> {
  const [uuid, documentTypeId] = await Promise.all([
    heroTempUpload(file),
    getGenericDocumentTypeId(),
  ]);

  const created = await heroGraphQL<{ upload_document: { id: number } | null }>(
    `mutation ($doc: CustomerDocumentInput!, $uuid: String!, $target: Int!) {
      upload_document(
        document: $doc
        file_upload_uuid: $uuid
        target: project_match
        target_id: $target
      ) {
        id
      }
    }`,
    {
      doc: {
        project_match_id: projectMatchId,
        file_upload_folder_id: folderId,
        document_type_id: documentTypeId,
        type: "generic",
      },
      uuid,
      target: projectMatchId,
    }
  );

  const docId = created.upload_document?.id;
  if (!docId) throw new Error("Dokument konnte in HERO nicht abgelegt werden.");
  return docId;
}
