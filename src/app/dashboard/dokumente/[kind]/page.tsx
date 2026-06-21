import { notFound } from "next/navigation";
import DocumentsList from "@/components/DocumentsList";
import { DOC_KINDS, isDocKind } from "@/lib/document-kinds";

export default async function DokumenteKindPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!isDocKind(kind)) notFound();
  const def = DOC_KINDS[kind];

  return (
    <div className="flex w-full max-w-full flex-1 flex-col gap-6 px-4 py-8">
      <DocumentsList title={def.label} typeIds={def.typeIds} />
    </div>
  );
}
