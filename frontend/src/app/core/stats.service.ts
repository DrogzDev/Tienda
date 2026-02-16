// src/app/core/stats.service.ts
import { Injectable, inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Api } from './api.service';

export interface StatsResponse {
  products: { total: number; active: number; inactive: number };
  stock: { global: number; por_sede: { store__code: string; total: number }[] };
  sales_last_30d: { count: number; total: number }; // total en Bs
  fx_usd?: number;
  fx_usd_raw?: number;
  fx_base?: 'USD';
  fx_currency?: 'VES';
}
export type KpiPeriod = 'week' | 'month' | 'year';

export interface StockAlertItem {
  id: number;
  name: string;
  sku: string | null;

  total_stock?: number;
  stocks?: number;

  threshold: number;
  is_active?: boolean;

  stocks_detail?: {
    store_id: number;
    store_code: string;
    quantity: number;
    min_threshold: number;
    updated_at?: string | null;
  }[];
}

export interface StockAlertsResponse {
  threshold: number;
  low_stock: StockAlertItem[];
  out_of_stock: StockAlertItem[];
  inactive_products?: StockAlertItem[];
}

export interface TopProduct {
  product_id: number;
  name: string;
  sku: string | null;
  total_units: number;
  total_sales_lines: number;
}

/** ✅ NUEVO: breakdown que viene dentro de sales_summary */
export interface SalesByPaymentMethod {
  payment_method: string; // "PAGO_MOVIL" | "PUNTO" | "DIVISAS" | "USDT" | ""
  sales_count: number;

  // backend los manda como string (Decimal); lo dejamos string para no perder precisión
  total_bs: string;
  total_usd: string;
  subtotal_bs: string;
  vat_bs: string;
}

/** ✅ NUEVO: resumen general */
export interface SalesSummary {
  sales_count: number;
  total_bs: string;
  total_usd: string;
  subtotal_bs: string;
  vat_bs: string;
  by_payment_method: SalesByPaymentMethod[];
}

/** ✅ ACTUALIZADO: ahora incluye sales_summary */
export interface TopProductsResponse {
  range: { start: string; end: string };
  period_used: string; // "week" | "month" | "year" | "custom"
  sales_summary: SalesSummary; // 👈 nuevo
  best_seller: TopProduct | null;
  top_products: TopProduct[];
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private api = inject(Api);

  /** default weekly */
  getTopProducts(params?: { period?: KpiPeriod; limit?: number }) {
    const period = params?.period ?? 'week';
    const limit = params?.limit ?? 10;

    const empty: TopProductsResponse = {
      range: { start: '', end: '' },
      period_used: period,
      sales_summary: {
        sales_count: 0,
        total_bs: '0',
        total_usd: '0',
        subtotal_bs: '0',
        vat_bs: '0',
        by_payment_method: []
      },
      best_seller: null,
      top_products: []
    };

    return this.api
      .get<TopProductsResponse>(
        `/inventory/kpis/sales/top-products/?period=${period}&limit=${limit}`
      )
      .pipe(
        map((res: any) => ({
          range: res?.range ?? empty.range,
          period_used: res?.period_used ?? period,

          // ✅ nuevo bloque
          sales_summary: {
            sales_count: Number(res?.sales_summary?.sales_count ?? 0),
            total_bs: String(res?.sales_summary?.total_bs ?? '0'),
            total_usd: String(res?.sales_summary?.total_usd ?? '0'),
            subtotal_bs: String(res?.sales_summary?.subtotal_bs ?? '0'),
            vat_bs: String(res?.sales_summary?.vat_bs ?? '0'),
            by_payment_method: Array.isArray(res?.sales_summary?.by_payment_method)
              ? res.sales_summary.by_payment_method.map((p: any) => ({
                  payment_method: String(p?.payment_method ?? ''),
                  sales_count: Number(p?.sales_count ?? 0),
                  total_bs: String(p?.total_bs ?? '0'),
                  total_usd: String(p?.total_usd ?? '0'),
                  subtotal_bs: String(p?.subtotal_bs ?? '0'),
                  vat_bs: String(p?.vat_bs ?? '0')
                }))
              : []
          },

          best_seller: res?.best_seller ?? null,
          top_products: Array.isArray(res?.top_products) ? res.top_products : []
        })),
        catchError(() => of(empty))
      );
  }

  getStockAlerts(params?: { threshold?: number }) {
    const threshold = params?.threshold ?? 5;

    return this.api.get<any>(`/inventory/kpis/stock/alerts/?threshold=${threshold}`).pipe(
      map((res) => ({
        threshold: Number(res?.threshold ?? res?.threshold_fallback ?? threshold),
        low_stock: Array.isArray(res?.low_stock) ? res.low_stock : [],
        out_of_stock: Array.isArray(res?.out_of_stock) ? res.out_of_stock : [],
        inactive_products: Array.isArray(res?.inactive_products) ? res.inactive_products : [],
      }) as StockAlertsResponse),
      catchError(() =>
        of({
          threshold,
          low_stock: [],
          out_of_stock: [],
          inactive_products: []
        } as StockAlertsResponse)
      )
    );
  }

  /** si quieres traerlos juntos */
  getKpis(params?: { period?: KpiPeriod; limit?: number; threshold?: number }) {
    return forkJoin({
      alerts: this.getStockAlerts({ threshold: params?.threshold }),
      top: this.getTopProducts({ period: params?.period, limit: params?.limit }),
    });
  }

  // ✅ QUITADO: getSalesDaily + SalesDailyResponse (ya no lo quieres)

  getStats() {
    const emptyStats: StatsResponse = {
      products: { total: 0, active: 0, inactive: 0 },
      stock: { global: 0, por_sede: [] },
      sales_last_30d: { count: 0, total: 0 },
      fx_usd: 1,
      fx_usd_raw: 1,
      fx_base: 'USD',
      fx_currency: 'VES'
    };

    const stats$ = this.api.get<StatsResponse>('/inventory/stats/').pipe(
      map((res) => ({
        products: res?.products ?? emptyStats.products,
        stock: res?.stock ?? emptyStats.stock,
        sales_last_30d: res?.sales_last_30d ?? emptyStats.sales_last_30d,
        fx_usd: Number((res as any)?.fx_usd ?? 1),
        fx_usd_raw: Number((res as any)?.fx_usd_raw ?? (res as any)?.fx_usd ?? 1),
        fx_base: (res as any)?.fx_base ?? 'USD',
        fx_currency: (res as any)?.fx_currency ?? 'VES'
      })),
      catchError(() => of(emptyStats))
    );

    const categories$ = this.api.get<any[]>('/inventory/categories/').pipe(
      map(r => (Array.isArray(r) ? r.length : (r as any)?.count ?? 0)),
      catchError(() => of(0))
    );

    const stores$ = this.api.get<any[]>('/inventory/stores/').pipe(
      map(r => (Array.isArray(r) ? r.length : (r as any)?.count ?? 0)),
      catchError(() => of(0))
    );

    return forkJoin({
      stats: stats$,
      categoriesCount: categories$,
      storesCount: stores$
    });
  }
}
