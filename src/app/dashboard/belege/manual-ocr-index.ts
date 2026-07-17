"use server";

import { getSession } from "@/lib/session";
import { getManualOcrStatus } from "@/lib/manual-receipts";
import { runManualOcrBackfillCore, type ManualOcrBackfillResult } from "@/lib/manual-ocr-core";

export interface ManualOcrStatus {
  total: number;
  done: number;
}

export async function getManualOcrIndexStatus(): Promise<ManualOcrStatus> {
  if (!(await getSession())) return { total: 0, done: 0 };
  try {
    return await getManualOcrStatus();
  } catch {
    return { total: 0, done: 0 };
  }
}

/** UI-Action „Volltext indexieren": Session-Guard + session-freier Kern. */
export async function runManualOcrBackfill(): Promise<ManualOcrBackfillResult> {
  if (!(await getSession())) return { processed: 0, remaining: 0, total: 0, costEur: 0, error: "Kein Zugriff." };
  return runManualOcrBackfillCore();
}
