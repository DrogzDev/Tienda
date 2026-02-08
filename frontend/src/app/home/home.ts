import { AfterViewInit, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StatsService, StatsResponse as StatsSrvResponse } from '../core/stats.service';
import { InventoryApi, StatsResponse as InvStats } from '../core/inventory.service';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.html'
})
export class HomeComponent implements AfterViewInit {
  private statsSrv = inject(StatsService);
  private invApi = inject(InventoryApi);

  @ViewChild('barCanvas') barCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pieCanvas') pieCanvas!: ElementRef<HTMLCanvasElement>;

  // UI: sidebar
  sidebarCollapsed = (localStorage.getItem('sidebarCollapsed') ?? '0') === '1';
  sidebarOpen = false; // móvil

  // métricas
  loading = true;
  categoriesCount = 0;
  storesCount = 0;
  productsTotal = 0;
  productsActive = 0;
  productsInactive = 0;
  stockGlobal = 0;
  salesCount30d = 0;
  salesTotal30d = 0; // ⬅️ ahora será USD SIEMPRE
  private _pendingBsForUsd = 0; // ⬅️ guarda Bs para convertir cuando llegue la tasa

  // gráficos
  sedeLabels: string[] = [];
  sedeValues: number[] = [];

  // tasa vigente (Bs por USD)
  fxUsd: number = 1;

  ngAfterViewInit(): void {
    // 1) Agregados de StatsService (ya leen /inventory/stats/)
    const agg$ = this.statsSrv.getStats().pipe(
      catchError(() => of({
        stats: {
          products: { total: 0, active: 0, inactive: 0 },
          stock: { global: 0, por_sede: [] },
          sales_last_30d: { count: 0, total: 0 },
          fx_usd: 1
        } as StatsSrvResponse,
        categoriesCount: 0,
        storesCount: 0
      }))
    );

    // 2) Stats del InventoryApi
    const inv$ = this.invApi.stats().pipe(
      catchError(() => of<InvStats>({
        products: { total: 0, active: 0, inactive: 0 },
        stock: { global: 0, por_sede: [] },
        sales_last_30d: { count: 0, total: 0 }
      }))
    );

    forkJoin({ agg: agg$, inv: inv$ }).subscribe({
      next: ({ agg, inv }) => {
        this.categoriesCount = agg.categoriesCount;
        this.storesCount = agg.storesCount;

        this.productsTotal = inv.products.total || agg.stats.products.total;
        this.productsActive = inv.products.active || agg.stats.products.active;
        this.productsInactive = inv.products.inactive || agg.stats.products.inactive;

        const stock = inv.stock.global > 0 ? inv.stock : agg.stats.stock;
        this.stockGlobal = stock.global;
        this.sedeLabels = stock.por_sede.map((r: { store__code: string }) => r.store__code);
        this.sedeValues = stock.por_sede.map((r: { total: number }) => r.total);

        const sales = (inv.sales_last_30d?.count ? inv.sales_last_30d : agg.stats.sales_last_30d) as any;
        this.salesCount30d = Number(sales?.count || 0);

        // --- USD preferente ---
        const totalUsdApi = Number(sales?.total_usd ?? sales?.usd);
        const totalBsApi  = Number(sales?.total_bs  ?? sales?.total);

        if (isFinite(totalUsdApi)) {
          this.salesTotal30d = totalUsdApi;            // ya viene en USD
        } else if (isFinite(totalBsApi) && Number(this.fxUsd) > 0) {
          this.salesTotal30d = +(totalBsApi / this.fxUsd).toFixed(2); // convierte a USD
        } else {
          this.salesTotal30d = 0;
          this._pendingBsForUsd = isFinite(totalBsApi) ? totalBsApi : 0; // espera a la tasa
        }

        // tasa desde agg si viene
        const fxFromAgg = Number((agg.stats as any)?.fx_usd);
        if (isFinite(fxFromAgg) && fxFromAgg > 0) {
          this.fxUsd = fxFromAgg;
          if (this._pendingBsForUsd > 0 && this.salesTotal30d === 0) {
            this.salesTotal30d = +(this._pendingBsForUsd / this.fxUsd).toFixed(2);
          }
        }

        this.loading = false;
        setTimeout(() => {
          this.drawBar();
          this.drawPie();
        }, 0);
      },
      error: () => {
        this.loading = false;
      }
    });

    // leer tasa directa y, si hacía falta, convertir los Bs pendientes a USD
    this.invApi.getFx().subscribe({
      next: (fx: any) => {
        const v = fx?.usd_to_bs != null ? Number(fx.usd_to_bs) : NaN;
        if (!isNaN(v) && v > 0) {
          this.fxUsd = v;
          if (this._pendingBsForUsd > 0 && this.salesTotal30d === 0) {
            this.salesTotal30d = +(this._pendingBsForUsd / this.fxUsd).toFixed(2);
          }
        }
      },
      error: () => {}
    });
  }

  // === Sidebar actions ===
  toggleCollapse() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try { localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed ? '1' : '0'); } catch {}
    // redibujar charts porque cambia ancho disponible
    setTimeout(() => { this.drawBar(); this.drawPie(); }, 250);
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  private drawBar() {
    const c = this.barCanvas?.nativeElement;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const W = c.width = c.clientWidth;
    const H = c.height = 300;
    ctx.clearRect(0, 0, W, H);

    const pad = 32;
    const base = H - pad;
    const vals = this.sedeValues.length ? this.sedeValues : [0];
    const max = Math.max(...vals, 10);
    const n = Math.max(this.sedeValues.length, 1);
    const step = (W - pad * 2) / n;
    const barW = step * 0.56;

    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, base);
    ctx.lineTo(W - pad, base);
    ctx.stroke();

    this.sedeValues.forEach((v, i) => {
      const h = (v / max) * (H - pad * 2);
      const x = pad + i * step + (step - barW) / 2;

      ctx.fillStyle = '#2563eb';
      ctx.shadowColor = 'rgba(37,99,235,.25)';
      ctx.shadowBlur = 8;
      ctx.fillRect(x, base - h, barW, h);
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#64748b';
      ctx.font = '12px ui-sans-serif,system-ui';
      const label = this.sedeLabels[i] || '';
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, x + barW / 2 - tw / 2, H - 10);
    });
  }

  private drawPie() {
    const c = this.pieCanvas?.nativeElement;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const W = c.width = c.clientWidth;
    const H = c.height = 300;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 16;

    const values = [this.productsActive || 0, this.productsInactive || 0];
    const colors = ['#10b981', '#f59e0b'];
    const labels = ['Activos', 'Inactivos'];
    const total = Math.max(values.reduce((a, b) => a + b, 0), 1);

    let start = -Math.PI / 2;
    values.forEach((v, i) => {
      const ang = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + ang);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
      start += ang;
    });

    // Leyenda
    const lx = 16;
    const ly = 16;
    labels.forEach((t, i) => {
      ctx.fillStyle = colors[i];
      ctx.fillRect(lx, ly + i * 22, 12, 12);
      ctx.fillStyle = '#1f2937';
      ctx.font = '13px ui-sans-serif,system-ui';
      ctx.fillText(`${t} (${values[i]})`, lx + 18, ly + 11 + i * 22);
    });
  }
}
