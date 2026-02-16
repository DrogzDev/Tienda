import { Component, OnInit, inject, signal } from '@angular/core';

import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InventoryApi, Product, Category, Store, StockRow } from '../core/inventory.service';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './product-detail.html'
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  inv = inject(InventoryApi);

  // Señales existentes
  loading = signal(true);
  saving  = signal(false);
  deletingImg = signal(false);

  // NUEVO: estado de borrado
  deletingProd = signal(false);

  // Sidebar rediseñado (mantengo tus signals)
  sidebarCollapsed = signal(false);
  sidebarOpen = signal(false);

  id!: number;
  product!: Product;
  categories: Category[] = [];
  stores: Store[] = [];

  imageUrl: string | null | undefined = null;

  form = this.fb.group({
    sku: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    price_usd: [0, [Validators.required, Validators.min(0)]],
    categories: this.fb.control<number[]>([])
  });

  ngOnInit(): void {
    this.id = +(this.route.snapshot.paramMap.get('id') || 0);
    if (!this.id) { this.router.navigate(['/products']); return; }

    this.loading.set(true);
    Promise.all([
      this.inv.listCategories().toPromise(),
      this.inv.listStores().toPromise(),
      this.inv.getProduct(this.id).toPromise(),
    ]).then(([cats, sts, prod]) => {
      this.categories = cats || [];
      this.stores = sts || [];
      this.product = prod as Product;

      this.form.patchValue({
        sku: this.product.sku,
        name: this.product.name,
        description: this.product.description || '',
        price_usd: this.product.price_usd ?? 0,
        categories: this.categoryIds(this.product)
      });

      this.imageUrl = this.product.image_url || null;
      this.loading.set(false);
    }).catch(() => {
      this.loading.set(false);
      alert('No se pudo cargar el producto.');
    });
  }

  // ----- Sidebar -----
  toggleCollapse(): void {
    this.sidebarCollapsed.set(!this.sidebarCollapsed());
    // opcional: persistencia como en home
    try { localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed() ? '1' : '0'); } catch {}
  }
  toggleSidebar(): void {
    this.sidebarOpen.set(!this.sidebarOpen());
  }

  // ----- helpers -----
  categoryIds(p: Product): number[] {
    const cats: any = p.categories ?? [];
    if (!Array.isArray(cats)) return [];
    if (cats.length && typeof cats[0] === 'object') return cats.map((x: any) => x?.id).filter((x: any) => typeof x === 'number');
    return cats as number[];
  }

  isCategorySelected(categoryId: number): boolean {
    const selectedCategories = this.form.get('categories')?.value || [];
    return selectedCategories.includes(categoryId);
  }

  toggleCategory(categoryId: number): void {
    const categoriesControl = this.form.get('categories');
    if (!categoriesControl) return;

    const currentCategories: number[] = categoriesControl.value || [];
    const newCategories = currentCategories.includes(categoryId)
      ? currentCategories.filter(id => id !== categoryId)
      : [...currentCategories, categoryId];

    categoriesControl.setValue(newCategories);
    categoriesControl.markAsDirty();
  }

  storesMissing(): Store[] {
    const have = new Set((this.product.stocks_detail || []).map(r => r.store_id));
    return this.stores.filter(s => !have.has(s.id));
  }

  // ----- acciones -----
  save() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);

    const payload = {
      sku: this.form.value.sku!,
      name: this.form.value.name!,
      description: this.form.value.description || '',
      price_usd: Number(this.form.value.price_usd ?? 0),
      categories: this.form.value.categories || []
    };

    this.inv.updateProduct(this.id, payload).subscribe({
      next: (p) => {
        this.product = p;
        this.imageUrl = p.image_url || null;
        this.saving.set(false);
        alert('Producto actualizado ✅');
      },
      error: (e) => { this.saving.set(false); alert(e?.error?.detail || 'Error al guardar'); }
    });
  }

  // NUEVO: eliminar producto
  deleteProduct() {
    if (this.deletingProd()) return;
    if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;

    this.deletingProd.set(true);
    // requiere que InventoryApi tenga deleteProduct(id: number)
    this.inv.deleteProduct(this.id).subscribe({
      next: () => {
        this.deletingProd.set(false);
        alert('Producto eliminado 🗑️');
        this.router.navigate(['/products']);
      },
      error: (e) => {
        this.deletingProd.set(false);
        alert(e?.error?.detail || 'No se pudo eliminar el producto');
      }
    });
  }

  onImageChange(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.inv.uploadProductImage(this.id, file).subscribe({
      next: (res) => { this.imageUrl = res.image_url; },
      error: () => alert('No se pudo subir la imagen')
    });
  }

  deleteImage() {
    if (!confirm('¿Quitar imagen?')) return;
    this.deletingImg.set(true);
    this.inv.deleteProductImage(this.id).subscribe({
      next: () => { this.imageUrl = null; this.deletingImg.set(false); },
      error: () => { this.deletingImg.set(false); alert('No se pudo eliminar la imagen'); }
    });
  }

  // --- stock ---
  setStock(row: StockRow, qtyEl: HTMLInputElement, minEl: HTMLInputElement) {
    const qty = Number(qtyEl.value);
    const min = Number(minEl.value || 0);
    this.inv.setStock(this.id, { store_id: row.store_id!, quantity: qty, min_threshold: min }).subscribe({
      next: (r) => {
        row.quantity = r.quantity;
        row.min_threshold = r.min_threshold;
        alert('Stock actualizado');
      },
      error: (e) => alert(e?.error?.detail || 'Error al fijar stock'),
    });
  }

  applyDelta(row: StockRow, deltaOrEl: number | HTMLInputElement) {
    const delta = typeof deltaOrEl === 'number' ? deltaOrEl : Number(deltaOrEl.value);
    if (!delta) return;
    this.inv.adjustStock(this.id, { store_id: row.store_id!, delta }).subscribe({
      next: (r) => {
        row.quantity = r.new_quantity;
        if (typeof deltaOrEl !== 'number') deltaOrEl.value = '';
      },
      error: (e) => alert(e?.error?.detail || 'Error en ajuste'),
    });
  }

  addStore(selectEl: HTMLSelectElement) {
    const storeId = Number(selectEl.value);
    if (!storeId) return;
    // crea fila con cantidad 0
    this.inv.setStock(this.id, { store_id: storeId, quantity: 0, min_threshold: 0 }).subscribe({
      next: (r) => {
        this.product.stocks_detail = this.product.stocks_detail || [];
        this.product.stocks_detail.push({
          store_id: r.store_id,
          store_code: (this.stores.find(s => s.id === r.store_id)?.code) || String(r.store_id),
          quantity: r.quantity,
          min_threshold: r.min_threshold,
          updated_at: new Date().toISOString()
        });
        selectEl.value = '';
      },
      error: (e) => alert(e?.error?.detail || 'No se pudo agregar la sede'),
    });
  }
}
