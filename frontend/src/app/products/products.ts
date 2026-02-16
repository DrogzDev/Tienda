import { Component, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InventoryApi } from '../core/inventory.service';

@Component({
  standalone: true,
  selector: 'app-products',
  imports: [FormsModule, RouterModule],
  templateUrl: './products.html',
})
export class ProductsComponent implements OnInit {
  q=''; category=''; store=''; is_active:any=''; min_stock:any='';
  categories:any[]=[]; stores:any[]=[]; items:any[]=[]; loading=false; err='';

  constructor(private inv: InventoryApi){}

  ngOnInit(){
    this.inv.listCategories().subscribe({next:d=>this.categories=d as any});
    this.inv.listStores().subscribe({next:d=>this.stores=d as any});
    this.fetch();
  }

  params(){
    const p:any={};
    if(this.q) p.q=this.q;
    if(this.category) p.category=this.category;
    if(this.store) p.store=this.store;
    if(this.is_active!=='') p.is_active=this.is_active;
    if(this.min_stock!=='') p.min_stock=this.min_stock;
    return p;
  }

  fetch(){
    this.loading=true; this.err='';
    this.inv.listProducts(this.params()).subscribe({
      next: (d:any)=>{ this.items=d; this.loading=false; },
      error: e=>{ this.err='Error cargando productos'; this.loading=false; }
    });
  }

  setStock(p:any){
    const store_id = prompt('ID de sede:');
    const quantity = prompt('Cantidad absoluta:');
    if(!store_id || quantity===null) return;
    this.inv.setStock(p.id, {store_id: +store_id, quantity: +quantity}).subscribe(()=>this.fetch());
  }

  adjustStock(p:any){
    const store_id = prompt('ID de sede:');
    const delta = prompt('Delta (+/-):');
    if(!store_id || delta===null) return;
    this.inv.adjustStock(p.id, {store_id: +store_id, delta: +delta}).subscribe(()=>this.fetch());
  }
}
