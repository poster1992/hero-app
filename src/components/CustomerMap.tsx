"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoJsonObject } from "geojson";
import type { ProjectLocation } from "@/lib/hero-api";

// Mittelpunkt Luxemburg.
const LUX_CENTER: [number, number] = [49.815, 6.13];
const RED = "#e8392a";
const YELLOW = "#eab308";

export default function CustomerMap({ locations }: { locations: ProjectLocation[] }) {
  const [showRed, setShowRed] = useState(true);
  const [showYellow, setShowYellow] = useState(true);
  const [border, setBorder] = useState<GeoJsonObject | null>(null);

  useEffect(() => {
    fetch("/luxembourg.geojson")
      .then((r) => r.json())
      .then(setBorder)
      .catch(() => {});
  }, []);

  const redCount = locations.filter((l) => l.hasOrder).length;
  const yellowCount = locations.length - redCount;
  const visible = locations.filter((l) => (l.hasOrder ? showRed : showYellow));

  const chip = (active: boolean, color: string) =>
    `flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "border-gray-400 bg-white text-gray-900" : "border-gray-300 text-gray-400 line-through"
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowRed((v) => !v)} className={chip(showRed, RED)}>
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: RED }} />
          Mit AB/Rechnung ({redCount})
        </button>
        <button
          type="button"
          onClick={() => setShowYellow((v) => !v)}
          className={chip(showYellow, YELLOW)}
        >
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: YELLOW }} />
          Ohne AB/Rechnung ({yellowCount})
        </button>
      </div>

      <MapContainer
        center={LUX_CENTER}
        zoom={9}
        scrollWheelZoom
        style={{ height: 520, width: "100%", borderRadius: 12, zIndex: 0 }}
      >
        <TileLayer
          className="map-grayscale"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {border && (
          <GeoJSON
            data={border}
            interactive={false}
            style={() => ({ color: "#e8392a", weight: 5, opacity: 0.95, fillOpacity: 0 })}
          />
        )}
        {visible.map((loc) => {
          const color = loc.hasOrder ? RED : YELLOW;
          return (
            <CircleMarker
              key={loc.id}
              center={[loc.lat, loc.lng]}
              radius={6}
              pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.85 }}
              eventHandlers={{
                mouseover: (e) => e.target.openPopup(),
                mouseout: (e) => e.target.closePopup(),
              }}
            >
              <Popup>
                <div style={{ fontSize: 13 }}>
                  <strong>
                    {loc.relativeId != null ? `#${loc.relativeId} · ` : ""}
                    {loc.name}
                  </strong>
                  {loc.customerName && <div>{loc.customerName}</div>}
                  <div style={{ color: "#555", marginTop: 2 }}>
                    {[loc.street, [loc.zipcode, loc.city].filter(Boolean).join(" ")]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                  <div style={{ marginTop: 4, color: loc.hasOrder ? "#b91c1c" : "#a16207" }}>
                    {loc.hasOrder ? "AB/Rechnung vorhanden" : "ohne AB/Rechnung"}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
