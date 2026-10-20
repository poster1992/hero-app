import { notFound } from "next/navigation";
import DocumentsList from "@/components/DocumentsList";
import { DOC_KINDS, isDocKind } from "@/lib/document-kinds";

export default async function DokumenteKindPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const def = DOC_KINDS[kind];
  const sp = await searchParams;
  const search = Array.isArray(sp.search) ? sp.search[0] : sp.search;

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-4 py-8">
      <DocumentsList title={def.label} typeIds={def.typeIds} initialQuery={search} />
    </div>
  );
}
