import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Datenblatt-Design: Archivo (Grotesk) als Haupt-/Displayschrift.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

// IBM Plex Mono für Labels, Codes, Zahlen (m², €, Projektnummern).
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "FLOORTEC",
  description: "FLOORTEC Dashboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "FLOORTEC" },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

// Tablets/Mobil (z. B. iPad) skalieren das komplette Desktop-Layout auf die
// Bildschirmbreite herunter (feste Layout-Breite). Desktop-Browser ignorieren
// dieses Meta und nutzen ihre echte Fensterbreite. Pinch-Zoom bleibt erlaubt.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
