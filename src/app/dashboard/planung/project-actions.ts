"use server";

import { getCalculatedHoursForProject } from "@/lib/hero-api";
import { getProjectPlannedManHours, type PlannedEntry } from "@/lib/planning-data";

export interface ProjectPlanningSummary {
  /** Calculated (Soll) labor hours from the Auftragsbestätigung. */
  calculatedHours: number;
  /** Man-hours already scheduled in the Plantafel (calendar). */
  plannedHours: number;
  /** Number of calendar events the planned hours come from. */
  eventCount: number;
  /** Per-block breakdown: when, how many hours, by whom. */
  entries: PlannedEntry[];
}

/** Calculated vs. already-planned hours for a single project. */
export async function getProjectPlanningSummary(
  projectId: number
): Promise<ProjectPlanningSummary> {
  const [calculatedHours, planned] = await Promise.all([
    getCalculatedHoursForProject(projectId),
    getProjectPlannedManHours(projectId),
  ]);
  return {
    calculatedHours,
    plannedHours: planned.plannedHours,
    eventCount: planned.eventCount,
    entries: planned.entries,
  };
}
