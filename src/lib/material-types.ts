// Client-safe warehouse types (NO database import).

export interface Material {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  minStock: number | null;
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
}
