"use client";

import dynamic from "next/dynamic";
import type { ProjectLocation } from "@/lib/hero-api";

// Leaflet greift auf `window` zu → nur clientseitig rendern.
const CustomerMap = dynamic(() => import("./CustomerMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] w-full items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-500">
      Karte wird geladen …
    </div>
  ),
});

export default function CustomerMapPanel({ locations }: { locations: ProjectLocation[] }) {
  return <CustomerMap locations={locations} />;
}
