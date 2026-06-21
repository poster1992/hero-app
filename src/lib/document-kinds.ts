// Document kinds for the "Dokumente" section (HERO customer_documents type ids).
//   Angebot = 1057591, Auftragsbestätigung = 1057579,
//   Rechnung = 1057585, Gutschrift = 1057587, Stornorechnung = 1057595.

export type DocKind = "angebote" | "auftraege" | "rechnungen";

export const DOC_KINDS: Record<DocKind, { label: string; typeIds: number[] }> = {
  angebote: { label: "Angebote", typeIds: [1057591] },
  auftraege: { label: "Aufträge", typeIds: [1057579] },
  rechnungen: { label: "Rechnungen", typeIds: [1057585, 1057587, 1057595] },
};

export function isDocKind(value: string): value is DocKind {
  return value === "angebote" || value === "auftraege" || value === "rechnungen";
}
