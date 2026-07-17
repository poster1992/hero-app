import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // jimp/pdf-lib (Beleg-Auto-Drehung) als externe Server-Pakete behandeln, damit
  // sie im Standalone-Output vollständig vorhanden sind (kein verpasstes Tracing).
  serverExternalPackages: ["jimp", "pdf-lib"],
  experimental: {
    // Datei-Uploads laufen über Server Actions – Standardlimit (1 MB) anheben,
    // damit Belege/Fotos/Krankmeldungen (bis 25 MB) hochgeladen werden können.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  // Die Login-Seite NIE zwischenspeichern. Sonst hält ein Gerät (v.a. iPhone
  // Safari/Home-Screen-PWA) die alte, vorgerenderte HTML fest, die auf nach dem
  // nächsten Deploy gelöschte _next/static-Chunks zeigt -> das Formular-JS lädt
  // nicht mehr und man kann sich "nicht mehr anmelden". no-store erzwingt bei
  // jedem Aufruf frische HTML passend zum aktuellen Build.
  async headers() {
    return [
      {
        source: "/login",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
