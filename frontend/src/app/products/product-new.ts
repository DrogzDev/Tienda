import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { InventoryApi, Store, Category, ProductCreatePayload } from '../core/inventory.service';

@Component({
  selector: 'app-product-new',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './product-new.html'
})
export class ProductNewComponent {
  private fb = inject(FormBuilder);
  private inv = inject(InventoryApi);
  private router = inject(Router);

  stores: Store[] = [];
  categories: Category[] = [];
  loading = true;
  error = '';
  saving = false;

  imageFile: File | null = null;
  imagePreview: string | null = null;

  form = this.fb.group({
    sku: ['', [Validators.required, Validators.maxLength(60)]],
    name: ['', [Validators.required, Validators.maxLength(160)]],
    description: [''],
    price_usd: [0, [Validators.required, Validators.min(0)]],
    categories: this.fb.control<number[]>([], [Validators.required, Validators.minLength(1)]),
    initial_stocks: this.fb.array<FormGroup>([])
  });

  ngOnInit() {
    this.inv.listStores().subscribe({
      next: s => { this.stores = s; this.loading = false; },
      error: _ => this.loading = false
    });
    this.inv.listCategories().subscribe({ next: c => this.categories = c });
    this.addStockRow();
  }

  // -------- Form helpers --------
  get f() { return this.form.controls; }
  get stocks() { return this.form.get('initial_stocks') as FormArray<FormGroup>; }

  onCategoryChange(categoryId: number, event: Event): void {
    const isChecked = (event.target as HTMLInputElement).checked;
    const current = (this.f.categories.value as number[]) || [];
    this.f.categories.setValue(isChecked ? [...current, categoryId] : current.filter(id => id !== categoryId));
    this.f.categories.markAsTouched();
  }

  addStockRow() {
    this.stocks.push(this.fb.group({
      store_id: [null, Validators.required],
      quantity: [0, [Validators.required, Validators.min(0)]],
      min_threshold: [0, [Validators.min(0)]],
    }));
  }

  removeStockRow(idx: number) {
    this.stocks.removeAt(idx);
  }

  autoSkuFromName() {
    const name = (this.f.name.value || '') as string;
    if (!name) return;
    const cleaned = name.trim().toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 16);
    if (!this.f.sku.value) this.f.sku.setValue(cleaned);
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) { this.imageFile = null; this.imagePreview = null; return; }
    this.imageFile = file;
    const reader = new FileReader();
    reader.onload = () => this.imagePreview = reader.result as string;
    reader.readAsDataURL(file);
  }

  submit() {
    this.error = '';
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error = 'Revisa los campos requeridos.';
      return;
    }

    // Validación de tiendas repetidas
    const used = new Set<number>();
    for (const g of this.stocks.controls) {
      const id = g.get('store_id')!.value;
      if (id == null) continue;
      if (used.has(id)) { this.error = 'No puedes repetir la misma sede en los stocks iniciales.'; return; }
      used.add(id);
    }

    const payload: ProductCreatePayload = {
      sku: this.f.sku.value!,
      name: this.f.name.value!,
      description: this.f.description.value || '',
      price_usd: Number(this.f.price_usd.value ?? 0),
      categories: (this.f.categories.value || []) as number[],
      initial_stocks: this.stocks.value.map(r => ({
        store_id: Number((r as any).store_id),
        quantity: Number((r as any).quantity),
        min_threshold: Number((r as any).min_threshold ?? 0),
      })),
    };

    this.saving = true;

    this.inv.createProduct(payload).subscribe({
      next: prod => {
        if (this.imageFile) {
          this.inv.uploadProductImage(prod.id, this.imageFile).subscribe({
            next: _ => this.router.navigate(['/products']),
            error: _ => this.router.navigate(['/products'])
          });
        } else {
          this.router.navigate(['/products']);
        }
      },
      error: err => {
        this.error = err?.error?.detail || 'No se pudo crear el producto.';
        this.saving = false;
      }
    });
  }
}
