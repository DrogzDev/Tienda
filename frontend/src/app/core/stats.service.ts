// src/app/core/stats.service.ts
import { Injectable, inject } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Api } from './api.service';

export interface StatsResponse {
  products: { total: number; active: number; inactive: number };
  stock: { global: number; por_sede: { store__code: string; total: number }[] };
  sales_last_30d: { count: number; total: number }; // total en Bs
  // opcionales: si quieres usar la tasa desde aquí
  fx_usd?: number;      // Bs por USD (para UI, 2 decimales en backend)
  fx_usd_raw?: number;  // Bs por USD exacto (4 decimales en backend)
  fx_base?: 'USD';
  fx_currency?: 'VES';
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private api = inject(Api);

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

    // 🚀 Ahora traemos todo del endpoint de stats del backend
    const stats$ = this.api.get<StatsResponse>('/inventory/stats/')
      .pipe(
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

    // Siguen los conteos auxiliares para categorías y tiendas
    const categories$ = this.api.get<any[]>('/inventory/categories/')
      .pipe(
        map(r => (Array.isArray(r) ? r.length : (r as any)?.count ?? 0)),
        catchError(() => of(0))
      );

    const stores$ = this.api.get<any[]>('/inventory/stores/')
      .pipe(
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
