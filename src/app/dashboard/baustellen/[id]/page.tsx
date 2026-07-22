import { notFound } from "next/navigation";
import { getBaustelle } from "@/lib/baustellen-docs";
import { getProjectPhotos, type ProjectPhoto } from "@/lib/hero-api";
import PhotoGallery from "@/components/PhotoGallery";
import PhotoUploadButton from "@/components/PhotoUploadButton";

export default async function BaustelleGalleryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bid = Number(id);
  const baustelle = Number.isFinite(bid) ? await getBaustelle(bid) : null;
  if (!baustelle) notFound();

  let photos: ProjectPhoto[] = [];
  let error: string | null = null;
  try {
    photos = await getProjectPhotos(baustelle.projectMatchId);
  } catch (e) {
    error = e instanceof Error ? e.message : "Fotos konnten nicht geladen werden.";
  }

  return (
    <div className="flex w-full max-w-none flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{baustelle.label}</h1>
          <p className="mt-1 text-sm text-gray-600">
            📁 {baustelle.imageCategory} · {baustelle.projectNr}
            {baustelle.projectName ? ` – ${baustelle.projectName}` : ""} · {photos.length} Fotos
          </p>
        </div>
        <PhotoUploadButton baustelleId={baustelle.id} />
      </header>

      {error ? (
        <div className="rounded-md border border-brand-red/30 bg-brand-red/10 p-4 text-sm text-red-300">
          Fehler beim Laden aus HERO: {error}
        </div>
      ) : photos.length === 0 ? (
        <div className="rounded-xl border border-gray-300 bg-white p-8 text-center text-sm text-gray-500 shadow-lg shadow-black/10">
          Keine Fotos in der Kategorie „{baustelle.imageCategory}" für {baustelle.projectNr}.
        </div>
      ) : (
        <PhotoGallery photos={photos} />
      )}
    </div>
  );
}
