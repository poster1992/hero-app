// Client-safe warehouse types (NO database import).

export interface Material {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  minStock: number | null;
}

export interface LagerItem {
  id: number; // HERO article (stock material) id
  name: string;
  itemNumber: string;
  qrId: string | null;
  /** Voller QR-Inhalt aus HERO (z. B. „hero:s:<qr_id>"). */
  qrPayload?: string | null;
  unit: string;
  category: string | null;
  quantity: number; // local stock (MySQL)
  ekPrice: number; // EK price (MySQL), 0 = nicht hinterlegt
  minStock: number | null; // Lager-Minimum (MySQL)
  maxStock: number | null; // Lager-Maximum (MySQL)
}

export interface LagerProjectOption {
  id: number;
  relativeId: number | null;
  name: string;
  /** Projekt ist in der Pipeline-Phase „In Umsetzung" (Ausbuchen nur dann erlaubt). */
  inImplementation?: boolean;
}

export interface StockMovement {
  id: number;
  materialId: number;
  materialName: string;
  delta: number;
  comment: string | null;
  byName: string | null;
  projectName: string | null;
  projectRelativeId: number | null;
  employeeName: string | null;
  at: string | null;
  /**
   * Auf der Buchung gespeicherter EK-Preis (Schnappschuss zum Buchungszeitpunkt);
   * null/0 = kein EK hinterlegt → Buchung zählt im Lagerausgang mit Wert 0.
   */
  ekPrice?: number | null;
}
