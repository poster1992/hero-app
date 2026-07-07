import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
