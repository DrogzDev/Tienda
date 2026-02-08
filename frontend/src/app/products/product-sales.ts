import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import {
  InventoryApi,
  Product,
  Store,
  Sale,
  SaleCreatePayload,
  SaleItemWrite,
  Category,
  PaymentMethod,
  PayCurrency
} from '../core/inventory.service';

// Si todavía NO exportaste PaymentMethod/PayCurrency desde el service,
// comenta esos imports y usa estas líneas:
// type PayCurrency = 'USD' | 'VES';
// type PaymentMethod = 'PAGO_MOVIL' | 'PUNTO' | 'DIVISAS' | 'USDT';

interface CartItem { product: Product; quantity: number; unitUSD: number; }

@Component({
  selector: 'app-products-sales',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './product-sales.html'
})
export class ProductsSalesComponent implements OnInit {
  private inv = inject(InventoryApi);

  // ==== Sidebar ====
  sidebarCollapsed = (localStorage.getItem('sidebarCollapsed') ?? '0') === '1';
  sidebarOpen = false;

  toggleCollapse() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try { localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed ? '1' : '0'); } catch {}
  }
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  }

  // catálogos
  stores: Store[] = [];
  categories: Category[] = [];
  selectedCats = signal<Set<number>>(new Set());

  // tasa FX (Bs por USD)
  fx = signal<number>(1);

  // filtros / ui
  storeCtrl = new FormControl<number | null>(null, { nonNullable: false, validators: [Validators.required] });

  // moneda “de impresión/tag” (esto NO es payment_method)
  currencyCtrl = new FormControl<PayCurrency>('USD', { nonNullable: true });

  search = new FormControl<string>('', { nonNullable: true });

  // ✅ NUEVO: datos de factura
  customerNameCtrl = new FormControl<string>('', { nonNullable: true });
  customerAddressCtrl = new FormControl<string>('', { nonNullable: true });
  customerIdDocCtrl = new FormControl<string>('', { nonNullable: true });
  customerPhoneCtrl = new FormControl<string>('', { nonNullable: true });

  // ✅ NUEVO: método de pago y referencia
  paymentMethodCtrl = new FormControl<PaymentMethod>('PAGO_MOVIL', { nonNullable: true });
  paymentRefCtrl = new FormControl<string>('', { nonNullable: true });

  // resultados
  searching = signal(false);
  results: Product[] = [];

  // carrito
  cart = signal<CartItem[]>([]);
  cartEmpty = computed(() => this.cart().length === 0);

  // totales
  subtotalUSD = computed(() =>
    this.cart().reduce((s, it) => s + (Number(it.unitUSD) || 0) * it.quantity, 0)
  );
  subtotalVES = computed(() => +(this.subtotalUSD() * this.fx()).toFixed(2));
  totalLabel = computed(() => this.currencyCtrl.value === 'USD' ? 'TOTAL USD' : 'TOTAL Bs');
  totalValue = computed(() => this.currencyCtrl.value === 'USD' ? this.subtotalUSD() : this.subtotalVES());

  // historial
  recent: Sale[] = [];
  loadingRecent = signal(false);

  // modal checkout
  showCheckout = signal(false);
  checkingOut = signal(false);

  ngOnInit(): void {
    // stores + tasa + ventas recientes
    this.inv.listStores().subscribe(sts => {
      this.stores = sts || [];
      if (!this.storeCtrl.value && this.stores.length === 1) this.storeCtrl.setValue(this.stores[0].id);
    });

    this.inv.listCategories().subscribe(cats => {
      this.categories = cats || [];
    });

    this.inv.getFx().subscribe(fx => this.fx.set(Number(fx?.usd_to_bs || 1)));
    this.loadRecent();

    // búsqueda reactiva
    this.search.valueChanges.pipe(debounceTime(250), distinctUntilChanged())
      .subscribe(q => this.findProducts(q || ''));

    // re-filtrar cuando cambie la sede
    this.storeCtrl.valueChanges.subscribe(() => this.findProducts(this.search.value || ''));

    // primera carga
    this.findProducts('');
  }

  // categorías
  toggleCat(catId: number) {
    const current = this.selectedCats();
    if (current.has(catId)) {
      this.selectedCats.set(new Set());
    } else {
      this.selectedCats.set(new Set([catId]));
    }
    this.findProducts(this.search.value || '');
  }
  clearCats() {
    this.selectedCats.set(new Set());
    this.findProducts(this.search.value || '');
  }

  private categoryIds(p: Product): number[] {
    const cats: any = (p as any)?.categories ?? [];
    if (!Array.isArray(cats)) return [];
    if (cats.length && typeof cats[0] === 'object') {
      return cats.map((x: any) => x?.id).filter((x: any) => typeof x === 'number');
    }
    return cats as number[];
  }

  private matchesCategories(p: Product): boolean {
    const wanted = this.selectedCats();
    if (!wanted.size) return true;
    const ids = this.categoryIds(p);
    return ids.some(id => wanted.has(id));
  }

  // abrir/cerrar modal
  openCheckout() {
    if (this.cartEmpty()) return;
    this.showCheckout.set(true);
  }

  closeCheckout() {
    if (this.checkingOut()) return;
    this.showCheckout.set(false);
  }

  // confirmar desde modal
  confirmCheckout() {
    if (this.checkingOut()) return;

    if (!this.storeCtrl.value) {
      alert('Selecciona una sede para facturar.');
      return;
    }
    if (this.cart().length === 0) {
      alert('Agrega productos al carrito.');
      return;
    }

    // Validación mínima de pago
    const pm = this.paymentMethodCtrl.value;
    if (pm === 'PAGO_MOVIL' && !this.paymentRefCtrl.value.trim()) {
      alert('Para Pago móvil debes ingresar la referencia.');
      return;
    }

    this.checkingOut.set(true);
    this.save();
  }

  // helpers de imagen
  imageUrl(p: any): string {
    const img = (p?.image as string | undefined) || (p?.image_url as string | undefined);
    if (!img) return '/assets/placeholder-product.png';
    if (/^https?:\/\//i.test(img)) return img;
    if (img.startsWith('/')) return img;
    return img;
  }
  onImgError(ev: Event) { (ev.target as HTMLImageElement).src = '/assets/placeholder-product.png'; }

  // stock helpers
  private toNum(v: any): number {
    const n = Number(v ?? 0);
    return isFinite(n) ? n : 0;
  }
  private rowsFromProduct(p: any): any[] {
    return (p?.stocks_detail as any[]) ??
           (p?.stocks as any[]) ??
           (p?.stock_rows as any[]) ??
           [];
  }
  private rowStoreId(r: any): number | null {
    const id = r?.store_id ?? r?.store?.id ?? r?.store ?? r?.store__id ?? null;
    return id != null ? Number(id) : null;
  }
  private rowQty(r: any): number {
    return this.toNum(r?.quantity ?? r?.qty ?? r?.q ?? r?.total ?? 0);
  }
  private mapFromProduct(p: any): Record<number, number> {
    const m = p?.stock_by_store ?? p?.stock_map ?? null;
    if (!m) return {};
    const out: Record<number, number> = {};
    for (const k of Object.keys(m)) out[Number(k)] = this.toNum(m[k]);
    return out;
  }

  stockInSelectedStore(p: any): number {
    const sid = this.storeCtrl.value;
    if (!sid) return 0;

    const mp = this.mapFromProduct(p);
    if (mp[sid] != null) return mp[sid];

    const rows = this.rowsFromProduct(p);
    const row = rows.find(r => this.rowStoreId(r) === sid);
    if (row) return this.rowQty(row);

    return 0;
  }

  private getGlobalStock(p: any): number {
    const total = p?.stock_total ?? p?.stock_global ?? p?.stock ?? null;
    if (total != null) return this.toNum(total);

    const mp = this.mapFromProduct(p);
    const sumMap = Object.values(mp).reduce((a, b) => a + this.toNum(b), 0);
    if (sumMap > 0) return sumMap;

    const rows = this.rowsFromProduct(p);
    if (rows.length) return rows.reduce((a, r) => a + this.rowQty(r), 0);

    return 0;
  }

  displayStock(p: Product): number | null {
    if (this.storeCtrl.value) return this.stockInSelectedStore(p);
    return null;
  }

  reservedInCart(productId: number): number {
    const item = this.cart().find(i => i.product.id === productId);
    return item ? item.quantity : 0;
  }

  availableNow(p: Product): number {
    const base = this.storeCtrl.value ? this.stockInSelectedStore(p) : this.getGlobalStock(p);
    return Math.max(0, base - this.reservedInCart(p.id));
  }

  priceVES(p: Product): number {
    return +(this.toNum((p as any).price_usd) * this.fx()).toFixed(2);
  }

  // carrito desde listado
  private cartItem(p: Product): CartItem | undefined {
    return this.cart().find(i => i.product.id === p.id);
  }
  qtyInCart(p: Product): number {
    return this.cartItem(p)?.quantity ?? 0;
  }
  addOne(p: Product) {
    if (this.availableNow(p) <= 0) return;
    const it = this.cartItem(p);
    if (it) this.inc(it, +1);
    else this.addProduct(p);
  }
  decOne(p: Product) {
    const it = this.cartItem(p);
    if (it) this.inc(it, -1);
  }

  // búsqueda productos
  findProducts(q: string) {
    this.searching.set(true);
    const params: any = { page_size: 40, ordering: 'name', is_active: true };
    if (q) params.search = q;
    params.include = 'stocks';

    this.inv.listProducts(params).subscribe({
      next: (res: any) => {
        const list: Product[] = Array.isArray(res) ? res : (res?.results ?? []);
        const sid = this.storeCtrl.value;
        const base = sid ? list.filter(p => this.stockInSelectedStore(p) > 0) : list;
        this.results = base.filter(p => this.matchesCategories(p));
        this.searching.set(false);
      },
      error: _ => {
        this.results = [];
        this.searching.set(false);
      }
    });
  }

  // carrito
  addProduct(p: Product) {
    if (this.availableNow(p) <= 0) return;

    const list = [...this.cart()];
    const idx = list.findIndex(i => i.product.id === p.id);
    const unit = Math.max(0, Number((p as any).price_usd ?? 0));

    if (idx >= 0) {
      const max = this.availableNow(p) + list[idx].quantity;
      const nextQty = Math.min(list[idx].quantity + 1, max);
      list[idx] = { ...list[idx], quantity: nextQty };
    } else {
      list.push({ product: p, quantity: 1, unitUSD: unit });
    }
    this.cart.set(list);
  }

  inc(item: CartItem, n: number) {
    const p = item.product;
    const maxAvail = this.availableNow(p) + item.quantity;
    const next = Math.max(0, Math.min(item.quantity + n, maxAvail));
    const list = this.cart()
      .map(it => it.product.id === p.id ? { ...it, quantity: next } : it)
      .filter(it => it.quantity > 0);
    this.cart.set(list);
  }

  remove(item: CartItem) {
    this.cart.set(this.cart().filter(it => it.product.id !== item.product.id));
  }

  updateUnitUSD(item: CartItem, event: Event) {
    const val = Number((event.target as HTMLInputElement).value);
    if (!isFinite(val) || val < 0) return;
    const list = this.cart().map(it => it.product.id === item.product.id ? { ...it, unitUSD: val } : it);
    this.cart.set(list);
  }

  unitVES(item: CartItem) { return +(item.unitUSD * this.fx()).toFixed(2); }

  // enviar venta
  save() {
    if (!this.storeCtrl.value) {
      alert('Selecciona una sede para facturar.');
      this.checkingOut.set(false);
      return;
    }
    if (this.cart().length === 0) {
      alert('Agrega productos al carrito.');
      this.checkingOut.set(false);
      return;
    }

    const pm: PaymentMethod = this.paymentMethodCtrl.value;

    const payC: PayCurrency =
      pm === 'PAGO_MOVIL' || pm === 'PUNTO'
        ? 'VES'
        : 'USD';

    // Validación referencia Pago móvil
    const ref = this.paymentRefCtrl.value.trim();
    if (pm === 'PAGO_MOVIL' && !ref) {
      alert('Para Pago móvil debes ingresar la referencia.');
      this.checkingOut.set(false);
      return;
    }

    const items: SaleItemWrite[] = this.cart().map(it => {
      return payC === 'USD'
        ? { product_id: it.product.id, quantity: it.quantity, unit_price_usd: +it.unitUSD.toFixed(2) }
        : { product_id: it.product.id, quantity: it.quantity, unit_price: +this.unitVES(it).toFixed(2) };
    });

    const payload: SaleCreatePayload = {
      store: this.storeCtrl.value,
      items,
      pay_currency_set: payC,
      notes: '',

      // ✅ nuevos campos factura
      customer_name: this.customerNameCtrl.value.trim(),
      customer_address: this.customerAddressCtrl.value.trim(),
      customer_id_doc: this.customerIdDocCtrl.value.trim(),
      customer_phone: this.customerPhoneCtrl.value.trim(),

      // ✅ pago
      payment_method: pm,
      payment_reference: ref || undefined,

      // vat_rate: 0.16, // opcional: si lo quieres fijo, lo omites y usa default backend
    };

    this.inv.createSale(payload).subscribe({
      next: (sale) => {
        // si implementaste saleInvoiceUrl con opts, úsalo.
        // const url = this.inv.saleInvoiceUrl(sale.id, { currency: payC });

        // fallback (como lo tenías)
        const url = this.inv.saleInvoiceUrl(sale.id) + `?currency=${payC}`;
        window.open(url, '_blank');

        this.cart.set([]);

        this.search.setValue(this.search.value || '');
        this.findProducts(this.search.value || '');
        this.loadRecent();

        this.checkingOut.set(false);
        this.showCheckout.set(false);
      },
      error: (e) => {
        alert(e?.error?.detail || 'No se pudo registrar la venta');
        this.checkingOut.set(false);
      }
    });
  }

  // historial
  loadRecent() {
    this.loadingRecent.set(true);
    this.inv.listSales({ page_size: 10 }).subscribe({
      next: (r: any) => {
        this.recent = Array.isArray(r) ? r : (r?.results ?? []);
        this.loadingRecent.set(false);
      },
      error: _ => {
        this.recent = [];
        this.loadingRecent.set(false);
      }
    });
  }

  openInvoice(id: number, currency: PayCurrency) {
    const url = this.inv.saleInvoiceUrl(id) + `?currency=${currency}`;
    window.open(url, '_blank');
  }
}
