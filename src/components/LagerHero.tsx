"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { LagerItem, LagerProjectOption } from "@/lib/material-types";

// Buchen-Dialog inkl. Kamera-Scanner erst beim ersten Öffnen laden (nicht im
// Initial-Bundle der Seite) – deutlich schnelleres erstes Laden auf Mobilgeräten.
const BookingScanModal = dynamic(() => import("@/components/BookingScanModal"), { ssr: false });

export type { LagerItem };

/** Lager-Startseite: nur Ein-/Ausbuchen (Bestandsliste & Buchungshistorie sind eigene Unterseiten). */
export default function LagerHero({
  items,
  projects,
}: {
  items: LagerItem[];
  projects: LagerProjectOption[];
}) {
  const [bookingOpen, setBookingOpen] = useState(false);
  // Erst nach dem ersten Klick mounten → der Modal-/Kamera-Code wird erst dann geladen.
  const [everOpened, setEverOpened] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => {
            setEverOpened(true);
            setBookingOpen(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-red px-5 py-4 text-base font-semibold text-white shadow transition-opacity hover:opacity-90 sm:w-auto sm:py-3"
        >
          <span aria-hidden className="text-lg">📷</span>
          Neue Buchung (scannen)
        </button>
        <p className="mt-3 text-sm text-gray-500">
          Artikel scannen und ein- oder ausbuchen. Die Artikelbestandsliste und die letzten
          Buchungen findest du im Menü unter „Lager".
        </p>
      </div>

      {everOpened && (
        <BookingScanModal
          open={bookingOpen}
          onClose={() => setBookingOpen(false)}
          projects={projects}
          articles={items.map((a) => ({
            id: a.id,
            name: a.name,
            itemNumber: a.itemNumber,
            qrId: a.qrId,
            qrPayload: a.qrPayload,
            unit: a.unit,
          }))}
        />
      )}
    </div>
  );
}
