"use server";

import { getProjectPhotos, type ProjectPhoto } from "@/lib/hero-api";

// Bewusst KEIN `export type { ProjectPhoto }` hier: Next.js/Turbopack behandelt
// jeden Export einer "use server"-Datei als Server-Action-Referenz und erzeugt
// dafür auch für reine Typ-Re-Exports einen (nicht existierenden) Laufzeit-
// Verweis – führt zur Laufzeit zu "ReferenceError: ProjectPhoto is not defined".
// Der Typ wird daher direkt aus "@/lib/hero-api" importiert, nicht von hier.

/** Fotos eines einzelnen Projekts, erst bei Bedarf (Aufklappen) geladen. */
export async function getGalleryPhotosAction(projectId: number): Promise<ProjectPhoto[]> {
  return getProjectPhotos(projectId);
}
