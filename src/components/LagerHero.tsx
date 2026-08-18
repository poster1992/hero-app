"use client";

import { useState } from "react";
import BookingScanModal from "@/components/BookingScanModal";
import type { LagerItem, LagerProjectOption } from "@/lib/material-types";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => setBookingOpen(true)}
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
    </div>
  );
}
