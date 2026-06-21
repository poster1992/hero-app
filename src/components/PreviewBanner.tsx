"use client";

import { useRouter } from "next/navigation";
import { setPreviewRole } from "@/app/dashboard/preview-actions";
import { roleLabel } from "@/lib/roles";

export default function PreviewBanner({ role }: { role: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-1.5 text-sm text-black">
      <span>
        Vorschau-Ansicht als Rolle <strong>{roleLabel(role)}</strong> – so sieht diese Gruppe das Menü.
      </span>
      <button
        type="button"
        onClick={async () => {
          await setPreviewRole(null);
          router.refresh();
        }}
        className="rounded-md border border-black/40 px-3 py-1 text-xs font-semibold hover:bg-black/10"
      >
        Zurück zur Admin-Ansicht
      </button>
    </div>
  );
}
