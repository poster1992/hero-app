const HERO_GRAPHQL_ENDPOINT = "https://login.hero-software.de/api/external/v7/graphql";

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

export async function heroGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = process.env.HERO_API_TOKEN;
  if (!token) {
    throw new Error("HERO_API_TOKEN is not configured");
  }

  const res = await fetch(HERO_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
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

export type ReceiptType = "output" | "income";

export interface ReceiptCustomer {
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
      first: 200
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

// ---------------------------------------------------------------------------
// Customer invoices ("Rechnungen", RE2026-*) — these live in customer_documents,
// NOT in Receipt_Receipts. Document type ids for FloorTec:
//   Rechnung = 1057585, Gutschrift = 1057587, Stornorechnung = 1057595.
// Stornorechnungen carry negative amounts (they reverse an invoice).
// ---------------------------------------------------------------------------

const INVOICE_DOCUMENT_TYPE_IDS = [1057585, 1057587, 1057595];

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
}

interface RawCustomerDocument {
  id: number;
  nr: string | null;
  date: string | null;
  value: number | null;
  vat: number | null;
  status_name: string | null;
  customer: { id: number; company_name: string | null; full_name: string | null } | null;
  project_match: { id: number; name: string } | null;
  file_upload: { id: number; filename: string; type: string | null; src: string | null } | null;
}

const CUSTOMER_INVOICES_QUERY = `
  query CustomerInvoices($typeIds: [Int], $first: Int, $offset: Int) {
    customer_documents(document_type_ids: $typeIds, orderBy: "id", first: $first, offset: $offset) {
      id
      nr
      date
      value
      vat
      status_name
      customer { id company_name full_name }
      project_match { id name }
      file_upload { id filename type src }
    }
  }
`;

/** Fetches all customer invoices (document type "Rechnung"), paginated. */
export async function getCustomerInvoices(): Promise<CustomerInvoice[]> {
  const pageSize = 200;
  const maxPages = 30; // safety cap (~6000 invoices)
  const result: CustomerInvoice[] = [];

  for (let page = 0; page < maxPages; page++) {
    const data = await heroGraphQL<{ customer_documents: RawCustomerDocument[] }>(
      CUSTOMER_INVOICES_QUERY,
      { typeIds: INVOICE_DOCUMENT_TYPE_IDS, first: pageSize, offset: page * pageSize }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
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
      });
    }
    if (docs.length < pageSize) break;
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
  const pageSize = 200;
  const maxPages = 30;
  const result: ProjectLocation[] = [];
  // Auftragsbestätigung = 1057579, Rechnung = 1057585; status 1000 = gelöscht.
  const ORDER_DOC_TYPES = new Set([1057579, 1057585]);

  for (let page = 0; page < maxPages; page++) {
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
      { first: pageSize, offset: page * pageSize }
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
    if (matches.length < pageSize) break;
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

/** All contacts (customers/suppliers), paginated. */
export async function getCustomers(): Promise<CustomerSummary[]> {
  const pageSize = 200;
  const maxPages = 60;
  const result: CustomerSummary[] = [];

  for (let page = 0; page < maxPages; page++) {
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
      { first: pageSize, offset: page * pageSize }
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
    if (contacts.length < pageSize) break;
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
  projectRelativeId: number | null;
  projectName: string | null;
}

/** Calendar events overlapping [from, to] (ISO datetime), with assigned partners. */
export async function getCalendarEvents(from: string, to: string): Promise<CalendarEventLite[]> {
  const pageSize = 200;
  const maxPages = 60;
  const result: CalendarEventLite[] = [];

  for (let page = 0; page < maxPages; page++) {
    const data = await heroGraphQL<{
      calendar_events: {
        id: number;
        title: string | null;
        start: string | null;
        end: string | null;
        all_day: boolean | null;
        deleted: boolean | null;
        partners: { id: number; name: string | null; role: string | null }[] | null;
        project_match: { relative_id: number | null; name: string | null } | null;
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
          project_match { relative_id name }
        }
      }`,
      { start: from, end: to, first: pageSize, offset: page * pageSize }
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
        projectRelativeId: e.project_match?.relative_id ?? null,
        projectName: e.project_match?.name ?? null,
      });
    }
    if (events.length < pageSize) break;
  }

  return result;
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
  const pageSize = 200;
  const maxPages = 30;
  const result: AbsenceLite[] = [];

  for (let page = 0; page < maxPages; page++) {
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
      { start: from, end: to, first: pageSize, offset: page * pageSize }
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
    if (absences.length < pageSize) break;
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
  partnerName: string;
  projectId: number | null;
  projectName: string | null;
  comment: string;
}

/** All time-tracking entries in [start, end) (yyyy-mm-dd), across all employees. */
export async function getTrackingTimes(start: string, end: string): Promise<TrackingTimeEntry[]> {
  const pageSize = 200;
  const maxPages = 60;
  const result: TrackingTimeEntry[] = [];

  for (let page = 0; page < maxPages; page++) {
    const data = await heroGraphQL<{
      tracking_times: {
        id: number;
        start: string | null;
        end: string | null;
        comment: string | null;
        partner: { id: number; name: string | null } | null;
        project_match: { id: number; name: string | null } | null;
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
          project_match { id name }
        }
      }`,
      { start, end, first: pageSize, offset: page * pageSize }
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
        partnerName: e.partner?.name ?? "Unbekannt",
        projectId: e.project_match?.id ?? null,
        projectName: e.project_match?.name ?? null,
        comment: e.comment ?? "",
      });
    }
    if (entries.length < pageSize) break;
  }

  return result;
}

/** Total worked hours per project (project_match id), across all time. */
export async function getHoursByProject(): Promise<Map<number, number>> {
  const pageSize = 200;
  const maxPages = 200;
  const byProject = new Map<number, number>();

  for (let page = 0; page < maxPages; page++) {
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
      { first: pageSize, offset: page * pageSize }
    );
    const entries = data.tracking_times ?? [];
    for (const e of entries) {
      if (e.project_match_id == null || !e.start || !e.end) continue;
      const ms = new Date(e.end).getTime() - new Date(e.start).getTime();
      if (ms <= 0) continue;
      byProject.set(e.project_match_id, (byProject.get(e.project_match_id) ?? 0) + ms / 3_600_000);
    }
    if (entries.length < pageSize) break;
  }

  for (const [k, v] of byProject) byProject.set(k, Math.round(v * 100) / 100);
  return byProject;
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
  const pageSize = 200;
  const maxPages = 30;
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

  for (let page = 0; page < maxPages; page++) {
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
      { first: pageSize, offset: page * pageSize }
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
    if (matches.length < pageSize) break;
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
  const pageSize = 200;
  const maxPages = 60;
  let offers = 0;
  let confirmations = 0;
  let invoiced = 0;

  for (let page = 0; page < maxPages; page++) {
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
        offset: page * pageSize,
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
    if (docs.length < pageSize) break;
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
  const pageSize = 200;
  const maxPages = 60;
  const offers = new Array(12).fill(0);
  const confirmations = new Array(12).fill(0);

  for (let page = 0; page < maxPages; page++) {
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
        offset: page * pageSize,
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
    if (docs.length < pageSize) break;
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
  const pageSize = 200;
  const maxPages = 60;
  const byProject = new Map<number, OfferInfo>();

  for (let page = 0; page < maxPages; page++) {
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
      { ids: [OFFER_DOCUMENT_TYPE_ID], first: pageSize, offset: page * pageSize }
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
    if (docs.length < pageSize) break;
  }

  for (const [k, v] of byProject) byProject.set(k, { ...v, sum: Math.round(v.sum * 100) / 100 });
  return byProject;
}

/**
 * Net invoiced amount per project: Rechnung (+) minus Gutschrift and
 * Stornorechnung (each subtracted by magnitude), deleted documents excluded.
 */
export async function getInvoiceNetByProject(): Promise<Map<number, number>> {
  const pageSize = 200;
  const maxPages = 30;
  const byProject = new Map<number, number>();

  for (let page = 0; page < maxPages; page++) {
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
      { ids: INVOICE_DOCUMENT_TYPE_IDS, first: pageSize, offset: page * pageSize }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || d.project_match_id == null) continue;
      const value = d.value ?? 0;
      const contribution =
        d.document_type_id === RECHNUNG_DOCUMENT_TYPE_ID ? value : -Math.abs(value);
      byProject.set(d.project_match_id, (byProject.get(d.project_match_id) ?? 0) + contribution);
    }
    if (docs.length < pageSize) break;
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
  acc: { minutes: number; material: number; laborCost: number }
): void {
  if (Array.isArray(node)) {
    for (const n of node) sumDraft(n, acc);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.type === "product" && typeof obj.time_minutes === "number") {
      acc.minutes += obj.time_minutes;
    }
    if (obj.atType === "SupplyProduct") {
      acc.material += toNumber(obj.base_price) * toNumber(obj.quantity);
    }
    // SupplyService.wage_base = planned labor cost (Kostenlohn) of that line.
    if (obj.atType === "SupplyService") {
      acc.laborCost += toNumber(obj.wage_base);
    }
    for (const v of Object.values(obj)) sumDraft(v, acc);
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
  const pageSize = 100;
  const maxPages = 60;
  const byProject = new Map<number, ProjectCalculation>();

  for (let page = 0; page < maxPages; page++) {
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
      { ids: [CONFIRMATION_DOCUMENT_TYPE_ID], first: pageSize, offset: page * pageSize }
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
    if (docs.length < pageSize) break;
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

/** Net sum of order confirmations (Auftragsbestätigungen) per project_match id. */
export interface ConfirmationInfo {
  net: number;
  /** Latest Auftragsbestätigung date, yyyy-mm-dd. */
  date: string | null;
}

export async function getConfirmationNetByProject(): Promise<Map<number, ConfirmationInfo>> {
  const pageSize = 200;
  const maxPages = 30;
  const byProject = new Map<number, ConfirmationInfo>();

  for (let page = 0; page < maxPages; page++) {
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
      { ids: [CONFIRMATION_DOCUMENT_TYPE_ID], first: pageSize, offset: page * pageSize }
    );
    const docs = data.customer_documents ?? [];
    for (const d of docs) {
      if (d.status_code === 1000 || d.project_match_id == null) continue; // skip deleted / unlinked
      const entry = byProject.get(d.project_match_id) ?? { net: 0, date: null };
      entry.net += d.value ?? 0;
      if (d.date && (!entry.date || d.date > entry.date)) entry.date = d.date;
      byProject.set(d.project_match_id, entry);
    }
    if (docs.length < pageSize) break;
  }

  for (const [k, v] of byProject) byProject.set(k, { ...v, net: Math.round(v.net * 100) / 100 });
  return byProject;
}

/** Fetches all projects (project_matches of type "project"), paginated. */
export async function getProjects(): Promise<ProjectSummary[]> {
  const pageSize = 200;
  const maxPages = 30;
  const result: ProjectSummary[] = [];

  for (let page = 0; page < maxPages; page++) {
    const data = await heroGraphQL<{ project_matches: RawProjectMatch[] }>(PROJECTS_QUERY, {
      first: pageSize,
      offset: page * pageSize,
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
    if (matches.length < pageSize) break;
  }

  return result;
}
