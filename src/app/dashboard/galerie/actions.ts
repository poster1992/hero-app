"use server";

import { getProjectPhotos, type ProjectPhoto } from "@/lib/hero-api";

export type { ProjectPhoto };

/** Fotos eines einzelnen Projekts, erst bei Bedarf (Aufklappen) geladen. */
export async function getGalleryPhotosAction(projectId: number): Promise<ProjectPhoto[]> {
  return getProjectPhotos(projectId);
}
