"use server";

import { getProjects } from "@/lib/hero-api";

export interface SearchProject {
  id: number;
  relativeId: number | null;
  name: string;
  customerName: string | null;
}

/** Project list for the global search (loaded lazily on first use). */
export async function listProjectsForSearch(): Promise<SearchProject[]> {
  const projects = await getProjects();
  return projects.map((p) => ({
    id: p.id,
    relativeId: p.relativeId,
    name: p.name,
    customerName: p.customerName,
  }));
}
