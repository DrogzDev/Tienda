import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InventoryApi } from '../core/inventory.service';

@Component({
  standalone: true,
  selector: 'app-stores',
  imports: [CommonModule],
  template: `
  <div class="bg-white border rounded-xl overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-gray-50"><tr><th class="p-2 text-left">ID</th><th class="p-2">Código</th><th class="p-2 text-left">Nombre</th></tr></thead>
      <tbody>
        <tr *ngFor="let s of items" class="border-t">
          <td class="p-2">{{s.id}}</td>
          <td class="p-2 text-center">{{s.code}}</td>
          <td class="p-2">{{s.name}}</td>
        </tr>
      </tbody>
    </table>
  </div>`,
})
export class StoresComponent implements OnInit {
  items:any[]=[];
  constructor(private inv: InventoryApi){}
  ngOnInit(){ this.inv.listStores().subscribe({next:(d:any)=>this.items=d}); }
}
