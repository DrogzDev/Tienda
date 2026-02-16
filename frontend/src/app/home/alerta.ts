import {
  Component, ElementRef, ViewChild, OnDestroy, OnInit, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Chart } from 'chart.js/auto';

import {
  StatsService,
  KpiPeriod,
  StockAlertItem,
  TopProduct,
  SalesSummary,
  SalesByPaymentMethod
} from '../core/stats.service';

@Component({
  standalone: true,
  selector: 'app-alertas',
  imports: [CommonModule, FormsModule],
  templateUrl: './alertas.html',
})
export class AlertasComponent implements OnInit, OnDestroy {
  private stats = inject(StatsService);

  // (opcional) si luego quieres un chart por método de pago
  @ViewChild('salesChart', { static: true }) salesChart!: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  // UI state
  loading = signal(false);
  error = signal<string | null>(null);

  threshold = signal<number>(5);
  period = signal<KpiPeriod>('week');     // SOLO top products
  limit = signal<number>(10);

  // data
  lowStock = signal<StockAlertItem[]>([]);
  outOfStock = signal<StockAlertItem[]>([]);
  topProducts = signal<TopProduct[]>([]);
  bestSeller = signal<TopProduct | null>(null);

  // ✅ nuevo: sales_summary (del endpoint top-products)
  salesSummary = signal<SalesSummary>({
    sales_count: 0,
    total_bs: '0',
    total_usd: '0',
    subtotal_bs: '0',
    vat_bs: '0',
    by_payment_method: []
  });

  // helpers UI (si quieres mostrar KPIs arriba)
  totalPeriodBs = computed(() => Number(this.salesSummary().total_bs || 0));
  totalPeriodUsd = computed(() => Number(this.salesSummary().total_usd || 0));
  totalPeriodCount = computed(() => Number(this.salesSummary().sales_count || 0));
  totalVatBs = computed(() => Number(this.salesSummary().vat_bs || 0));

  chartSubtitle = computed(() => 'Ventas por método de pago');

  ngOnInit(): void {
    // si no tienes canvas en el html, comenta estas 2 líneas
    this.initChart();
    this.refresh();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  refresh() {
    this.loading.set(true);
    this.error.set(null);

    this.stats.getKpis({
      threshold: this.threshold(),
      period: this.period(),
      limit: this.limit(),
    }).subscribe({
      next: (res: any) => {
        // alerts
        this.lowStock.set(res?.alerts?.low_stock ?? []);
        this.outOfStock.set(res?.alerts?.out_of_stock ?? []);

        // top products
        this.topProducts.set(res?.top?.top_products ?? []);
        this.bestSeller.set(res?.top?.best_seller ?? null);

        // ✅ nuevo: resumen ventas (viene dentro de res.top)
        this.salesSummary.set(res?.top?.sales_summary ?? this.salesSummary());

        // (opcional) actualizar chart con by_payment_method
        this.updateChart(this.salesSummary().by_payment_method ?? []);

        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los KPIs.');
        this.loading.set(false);
      }
    });
  }

  // Para compat: backend puede mandar total_stock o stocks
  stockOf(it: StockAlertItem) {
    return (it as any).total_stock ?? (it as any).stocks ?? 0;
  }

  /** ✅ Chart opcional: Ventas por método (count o total_bs) */
  private initChart() {
    const ctx = this.salesChart?.nativeElement?.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Cantidad de ventas',
            data: [],
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (v) => `${Number(v).toLocaleString('es-VE')}` } }
        }
      }
    });
  }

  private updateChart(rows: SalesByPaymentMethod[]) {
    if (!this.chart) return;

    const labels = rows.map(r => r.payment_method || 'N/A');
    const data = rows.map(r => Number(r.sales_count || 0)); // o Number(r.total_bs) si prefieres Bs

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = data;

    this.chart.update();
  }
}
