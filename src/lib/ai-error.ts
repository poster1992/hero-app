import Anthropic from "@anthropic-ai/sdk";

/**
 * Einheitliche, verständliche Meldung, wenn das Anthropic-Guthaben aufgebraucht ist.
 * Wird überall angezeigt, wo KI läuft (OCR, Daten-Assistent, Tagesbericht).
 */
export const AI_CREDIT_MESSAGE =
  "KI-Guthaben aufgebraucht – bitte in der Anthropic-Konsole aufladen.";

/**
 * Erkennt einen Anthropic-Fehler wegen leerem Guthaben / Abrechnungslimit.
 * Anthropic liefert das je nach Fall als billing_error (403) oder als 400/429
 * mit "credit balance is too low" – daher robust über Typ UND Meldung geprüft.
 */
export function isCreditError(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  const status = e.status ?? 0;
  const body = (e as { error?: { error?: { type?: string; message?: string } } }).error;
  const type = body?.error?.type ?? "";
  const msg = `${body?.error?.message ?? ""} ${e.message ?? ""}`.toLowerCase();
  if (type === "billing_error") return true;
  if (
    (status === 400 || status === 402 || status === 403 || status === 429) &&
    /(credit balance is too low|billing|purchase credits|insufficient|quota exceeded)/.test(msg)
  ) {
    return true;
  }
  return false;
}

/**
 * Liefert eine benutzerfreundliche Fehlermeldung: bei aufgebrauchtem Guthaben die
 * deutsche Guthaben-Meldung, sonst die ursprüngliche Fehlermeldung (oder ein Fallback).
 */
export function aiErrorMessage(e: unknown, fallback = "KI-Verarbeitung fehlgeschlagen."): string {
  if (isCreditError(e)) return AI_CREDIT_MESSAGE;
  return e instanceof Error && e.message ? e.message : fallback;
}
