import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged, startWith, Subscription, forkJoin } from 'rxjs';
import { InventoryApi, Product, StockRow, Paginated, Category, Store } from '../core/inventory.service';
import { SidebarState } from '../core/sidebar.state';
type StatusFilter = 'all' | 'active' | 'inactive';

@Component({
  selector: 'app-products-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './products-list.html'
})
export class ProductsListComponent extends SidebarState implements OnInit, OnDestroy {
  private inv = inject(InventoryApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // ui
  loading = signal(true);
  error = signal('');

  // data
  categories: Category[] = [];
  categoryName: Record<number, string> = {};
  stores: Store[] = [];

  allItems: Product[] = [];
  visibleItems: Product[] = [];

  // filtros
  search = new FormControl<string>('', { nonNullable: true });
  storeFilter = new FormControl<number | null>(null);
  statusFilter = new FormControl<StatusFilter>('active', { nonNullable: true }); // ⬅️ NUEVO
  selectedCats = signal<Set<number>>(new Set());

  // paginación
  count = 0;
  page = 1;
  pageSize = 9;

  // stocks inline
  openRow: { [id: number]: boolean } = {};
  stocksMap: { [id: number]: StockRow[] } = {};
  stocksLoading: { [id: number]: boolean } = {};

  private sub?: Subscription;

  ngOnInit() {
    const qp = this.route.snapshot.queryParamMap;
    this.page     = Number(qp.get('page') || 1);
    this.pageSize = Number(qp.get('page_size') || 9);
    this.search.setValue(qp.get('search') || '');

    // catálogos
    this.loading.set(true);
    forkJoin({
      cats: this.inv.listCategories(),
      sts:  this.inv.listStores()
    }).subscribe({
      next: ({ cats, sts }) => {
        this.categories = cats || [];
        this.categoryName = Object.fromEntries(this.categories.map(c => [c.id, c.name]));
        this.stores = sts || [];
        this.loading.set(false);
      },
      error: _ => this.loading.set(false)
    });

    // búsqueda
    this.sub = this.search.valueChanges.pipe(
      startWith(this.search.value),
      debounceTime(250),
      distinctUntilChanged()
    ).subscribe(() => {
      this.page = 1;
      this.updateRoute();
      this.load();
    });

    // filtros en cliente
    this.storeFilter.valueChanges.subscribe(() => this.applyFilters());
    this.statusFilter.valueChanges.subscribe(() => this.applyFilters()); // ⬅️ NUEVO

    // primera carga
    this.load();
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }

  /** ===== Carga ===== */
  load() {
    this.loading.set(true);
    this.error.set('');

    const params: any = {
      page: this.page,
      page_size: this.pageSize,
      ordering: '-created_at'
    };
    if (this.search.value) params.search = this.search.value;

    this.inv.listProducts(params).subscribe({
      next: (res) => {
        if (Array.isArray(res)) {
          this.allItems = res;
          this.count = res.length;
        } else {
          const p = res as Paginated<Product>;
          this.allItems = p.results || [];
          this.count = p.count || this.allItems.length;
        }
        this.applyFilters();
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.detail || 'No se pudo cargar el catálogo.');
        this.allItems = [];
        this.visibleItems = [];
        this.count = 0;
        this.loading.set(false);
      }
    });
  }

  /** ===== Filtros cliente ===== */
  private matchesStore(p: Product): boolean {
    const storeId = this.storeFilter.value;
    if (!storeId) return true;
    const rows = (p as any)?.stocks_detail as any[] | undefined;
    if (!rows || !rows.length) return false;
    const row = rows.find(r => r.store_id === storeId);
    return row ? Number(row.quantity) > 0 : false;
  }

  private matchesCategories(p: Product): boolean {
    const wanted = this.selectedCats();
    if (!wanted.size) return true;
    const ids = this.categoryIds(p);
    return ids.some(id => wanted.has(id));
  }

  private matchesStatus(p: Product): boolean {                   // ⬅️ NUEVO
    const sf = this.statusFilter.value;
    if (sf === 'all') return true;
    if (sf === 'active') return !!(p as any).is_active;
    return !(p as any).is_active; // 'inactive'
  }

  applyFilters() {
    const filtered = this.allItems
      .filter(p => this.matchesStore(p) && this.matchesCategories(p) && this.matchesStatus(p));
    this.visibleItems = filtered;
  }

  // toggles de categorías
  toggleCat(catId: number) {
    const set = new Set(this.selectedCats());
    if (set.has(catId)) set.delete(catId); else set.add(catId);
    this.selectedCats.set(set);
    this.applyFilters();
  }
  clearCats() {
    this.selectedCats.set(new Set());
    this.applyFilters();
  }

  /** ===== Helpers template ===== */
  categoryIds(p: Product): number[] {
    const cats: any = (p as any)?.categories ?? [];
    if (!Array.isArray(cats)) return [];
    if (cats.length && typeof cats[0] === 'object') return cats.map((x: any) => x?.id).filter((x: any) => typeof x === 'number');
    return cats as number[];
  }
  trackId(_i: number, id: number) { return id; }

  stockInStore(p: Product, storeId: number | null): number {
    if (!storeId) return (p as any).total_stock ?? 0;
    const rows = (p as any)?.stocks_detail as any[] | undefined;
    if (!rows) return 0;
    const row = rows.find(r => r.store_id === storeId);
    return row ? Number(row.quantity) : 0;
  }

  imageUrl(p: any): string {
    const img = (p?.image as string | undefined) || (p?.image_url as string | undefined);
    if (!img) return '/assets/placeholder-product.png';
    if (/^https?:\/\//i.test(img)) return img;
    if (img.startsWith('/media/')) return img;
    return img;
  }
  onImgError(ev: Event) { (ev.target as HTMLImageElement).src = '/assets/placeholder-product.png'; }

  // paginación
  pageItems(): Product[] {
    if (Array.isArray(this.allItems) && this.count === this.allItems.length) {
      const start = (this.page - 1) * this.pageSize;
      return this.visibleItems.slice(start, start + this.pageSize);
    }
    return this.visibleItems;
  }

  totalPages(): number {
    const total = (this.count && this.count !== this.allItems.length) ? this.count : this.visibleItems.length;
    return Math.max(1, Math.ceil(total / this.pageSize));
  }
  prevPage() {
    if (this.page > 1) {
      this.page--;
      this.updateRoute();
      this.load();
    }
  }
  nextPage() {
    if (this.page < this.totalPages()) {
      this.page++;
      this.updateRoute();
      this.load();
    }
  }

  updateRoute() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: this.search.value || null,
        page: this.page !== 1 ? this.page : null,
        page_size: this.pageSize !== 9 ? this.pageSize : null
      },
      queryParamsHandling: 'merge'
    });
  }

  // stocks desplegables
  toggleStocks(p: Product) {
    const opened = !!this.openRow[p.id];
    if (opened) { this.openRow[p.id] = false; return; }
    this.openRow[p.id] = true;
    if (!this.stocksMap[p.id]) {
      this.stocksLoading[p.id] = true;
      this.inv.productStocks(p.id).subscribe({
        next: rows => { this.stocksMap[p.id] = rows; this.stocksLoading[p.id] = false; },
        error: _ => { this.stocksMap[p.id] = []; this.stocksLoading[p.id] = false; }
      });
    }
  }

  // navegación
  goNew() { this.router.navigate(['/products/new']); }
}
