// src/app/core/services/inventory.service.ts
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Api } from './api.service';

export type PayCurrency = "USD" | "VES";
export type PaymentMethod = "PAGO_MOVIL" | "PUNTO" | "DIVISAS" | "USDT";


/** ===== Tipos ===== */
export interface Store {
  id: number;
  name: string;
  code: string;
  address?: string;
  is_active: boolean;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface StockRow {
  id?: number;
  store?: Store;
  store_id?: number;
  quantity: number;
  min_threshold: number;
  updated_at?: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description?: string;
  categories: number[] | Category[];
  is_active: boolean;
  created_at: string;
  total_stock: number;
  image_url?: string | null;
  /** NUEVO: precio base en USD */
  price_usd?: number;
  stocks_detail?: Array<{
    store_id: number;
    store_code: string;
    quantity: number;
    min_threshold: number;
    updated_at: string;
  }>;
}

export interface ProductCreatePayload {
  sku: string;
  name: string;
  description?: string;
  categories?: number[];
  /** NUEVO */
  price_usd?: number;
  initial_stocks?: { store_id: number; quantity: number; min_threshold?: number }[];
}

export type ProductUpdatePayload = Partial<ProductCreatePayload>;

export interface StatsResponse {
  products: { total: number; active: number; inactive: number };
  stock: { global: number; por_sede: { store__code: string; total: number }[] };
  sales_last_30d: { count: number; total: number };
  /** opcional: viene del backend si lo habilitamos en stats */
  fx_usd?: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Ítem de venta (read) */
export interface SaleItemWrite {
  product_id: number; // ✅ backend
  quantity: number;
  unit_price?: number | string | null;
  unit_price_usd?: number | string | null;
}

export interface SaleItem {
  id: number;
  product: number;           // o Product si tu backend lo expone
  quantity: number;
  unit_price?: number;       // Bs
  unit_price_usd?: number;   // USD
  line_total: number;        // Bs (si tu backend lo manda así)
}

export interface Sale {
  id: number;
  store: number;
  created_by: number;
  created_at: string;

  customer_name: string;
  customer_address: string;
  customer_id_doc: string;
  customer_phone: string;

  payment_method: PaymentMethod;
  payment_reference: string;

  vat_rate: number;
  subtotal_bs: number;
  vat_bs: number;

  total: number;
  total_usd?: number;
  fx_usd?: string;

  notes?: string;
  pay_currency?: PayCurrency;

  items_detail: SaleItem[];
}

export interface SaleCreatePayload {
  store: number;
  notes?: string;
  items: SaleItemWrite[];
  pay_currency_set?: PayCurrency;

  customer_name: string;
  customer_address: string;
  customer_id_doc: string;
  customer_phone: string;

  payment_method: PaymentMethod;
  payment_reference?: string; // requerido si PAGO_MOVIL

  vat_rate?: number; // opcional
}

export interface SetStockResponse {
  product: number;
  store_id: number;
  quantity: number;
  min_threshold: number;
}

export interface AdjustStockResponse {
  product: number;
  store_id: number;
  new_quantity: number;
}

export interface ProductQuery {
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  is_active?: boolean;
  [key: string]: any;
}

export interface SalesQuery {
  page?: number;
  page_size?: number;
  store?: number;
  date_from?: string;
  date_to?: string;
  [key: string]: any;
}

/** FX */
export interface FxResponse {
  usd_to_bs: string;
  effective_date: string | null;
}

/** ===== Servicio ===== */
@Injectable({ providedIn: 'root' })
export class InventoryApi {
  constructor(private api: Api) {}

  // --- Stats ---
  stats(): Observable<StatsResponse> {
    return this.api.get<StatsResponse>('/inventory/stats/');
  }

  // --- FX (tasa Bs por USD) ---
  getFx(): Observable<FxResponse> {
    return this.api.get<FxResponse>('/inventory/fx/');
  }
  // (opcional, sólo admin)
  setFx(usd_to_bs: number): Observable<FxResponse> {
    return this.api.post<FxResponse>('/inventory/fx/', { usd_to_bs });
  }

  // --- Products ---
  listProducts(params?: ProductQuery): Observable<Product[] | Paginated<Product>> {
    return this.api.get<Product[] | Paginated<Product>>('/inventory/products/', params);
  }

  getProduct(id: number): Observable<Product> {
    return this.api.get<Product>(`/inventory/products/${id}/`);
  }

  createProduct(payload: ProductCreatePayload): Observable<Product> {
    return this.api.post<Product>('/inventory/products/', payload);
  }

  updateProduct(id: number, payload: ProductUpdatePayload): Observable<Product> {
    return this.api.put<Product>(`/inventory/products/${id}/`, payload);
  }

  deleteProduct(id: number): Observable<void> {
    return this.api.delete<void>(`/inventory/products/${id}/`);
  }

  // Imagen del producto
  uploadProductImage(id: number, file: File): Observable<{ image_url: string }> {
    const fd = new FormData();
    fd.append('image', file);
    return this.api.postForm<{ image_url: string }>(`/inventory/products/${id}/image/`, fd);
  }

  deleteProductImage(id: number): Observable<void> {
    return this.api.delete<void>(`/inventory/products/${id}/image/`);
  }

  productStocks(id: number): Observable<StockRow[]> {
    return this.api.get<StockRow[]>(`/inventory/products/${id}/stocks/`);
  }

  setStock(
    id: number,
    payload: { store_id: number; quantity: number; min_threshold?: number }
  ): Observable<SetStockResponse> {
    return this.api.post<SetStockResponse>(`/inventory/products/${id}/set_stock/`, payload);
  }

  adjustStock(
    id: number,
    payload: { store_id: number; delta: number }
  ): Observable<AdjustStockResponse> {
    return this.api.post<AdjustStockResponse>(`/inventory/products/${id}/adjust_stock/`, payload);
  }

  // --- Stores & Categories ---
  listStores(): Observable<Store[]> {
    return this.api.get<Store[]>('/inventory/stores/');
  }

  listCategories(): Observable<Category[]> {
    return this.api.get<Category[]>('/inventory/categories/');
  }

  // --- Sales ---
  listSales(params?: SalesQuery): Observable<Paginated<Sale> | Sale[]> {
    return this.api.get<Paginated<Sale> | Sale[]>('/inventory/sales/', params);
  }

  createSale(payload: SaleCreatePayload): Observable<Sale> {
    return this.api.post<Sale>('/inventory/sales/', payload);
  }

  saleInvoiceUrl(id: number): string {
    return this.api.resolveAbsoluteUrl(`/inventory/sales/${id}/invoice/`);
  }
}
