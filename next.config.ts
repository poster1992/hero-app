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
};

export default nextConfig;
