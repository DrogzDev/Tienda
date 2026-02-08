// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './app/core/auth.guard';

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
      // Privadas
      {
        path: 'home',
        loadComponent: () =>
          import('./app/home/home').then(m => m.HomeComponent),
      },
      {
        path: 'products',
        loadComponent: () =>
          import('./app/products/products-list').then(m => m.ProductsListComponent),
      },
      {
        path: 'products/new',
        loadComponent: () =>
          import('./app/products/product-new').then(m => m.ProductNewComponent),
      },
      {
        path: 'products/:id',
        loadComponent: () =>
          import('./app/products/product-detail').then(m => m.ProductDetailComponent),
      },
      {
        path: 'sales',
        loadComponent: () =>
          import('./app/products/product-sales').then(m => m.ProductsSalesComponent),
      },

      // Redirecciones
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: '**', redirectTo: 'home' },
    ],
  },
];
