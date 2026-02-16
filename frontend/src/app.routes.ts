// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './app/core/auth.guard';
import { groupGuard } from './app/auth/group.guard';

export const routes: Routes = [
  // Pública
  {
    path: 'login',
    loadComponent: () =>
      import('./app/auth/login/login').then(m => m.LoginComponent),
  },

  // ✅ SHELL (envuelve privadas)
  {
    path: '',
    loadComponent: () =>
      import('./app/shared/components/shell/shell').then(m => m.ShellComponent),
    canActivateChild: [authGuard],
    children: [
      // Privadas (cualquier usuario autenticado)
      {
        path: 'home',
        canActivate: [groupGuard(['VENDEDOR', 'STAFF'])],
        loadComponent: () =>
          import('./app/home/home').then(m => m.HomeComponent),
      },
      {
        path: 'alertas',
        canActivate: [groupGuard(['VENDEDOR', 'STAFF'])],
        loadComponent: () =>
          import('./app/home/alerta').then(m => m.AlertasComponent),
      },

      // ✅ Solo staff o grupo VENDEDOR
      {
        path: 'products',
        canActivate: [groupGuard(['VENDEDOR' , 'STAFF'])],
        loadComponent: () =>
          import('./app/products/products-list').then(m => m.ProductsListComponent),
      },
      {
        path: 'products/new',
        canActivate: [groupGuard(['STAFF'])],
        loadComponent: () =>
          import('./app/products/product-new').then(m => m.ProductNewComponent),
      },
      {
        path: 'products/:id',
        canActivate: [groupGuard(['VENDEDOR'])],
        loadComponent: () =>
          import('./app/products/product-detail').then(m => m.ProductDetailComponent),
      },
      {
        path: 'sales',
        canActivate: [groupGuard(['VENDEDOR'])],
        loadComponent: () =>
          import('./app/products/product-sales').then(m => m.ProductsSalesComponent),
      },

      // Redirecciones
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: '**', redirectTo: 'home' },
    ],
  },
];
