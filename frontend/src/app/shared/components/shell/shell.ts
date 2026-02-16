import { Component, OnInit, signal } from '@angular/core';

import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
})
export class ShellComponent implements OnInit {
  sidebarCollapsed = signal(false);
  sidebarOpen = signal(false);

  navItems: Array<{ to: string; label: string; icon: 'home' | 'products' | 'add' | 'sales'|'alert' }> = [
    { to: '/home', label: 'Home', icon: 'home' },
    { to: '/products', label: 'Productos', icon: 'products' },
    { to: '/products/new', label: 'Crear Producto', icon: 'add' },
    { to: '/sales', label: 'Ventas', icon: 'sales' },
    { to: '/alertas', label: 'Alertas', icon: 'alert' },
  ];

  toggleCollapse(): void {
    this.sidebarCollapsed.set(!this.sidebarCollapsed());
  }

  toggleSidebar(): void {
    this.sidebarOpen.set(!this.sidebarOpen());
  }

  toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';

    html.setAttribute('data-theme', next);
    html.classList.toggle('dark', next === 'dark');

    localStorage.setItem('theme', next);
  }

  ngOnInit() {
    const saved = localStorage.getItem('theme') || 'light';
    const html = document.documentElement;

    html.setAttribute('data-theme', saved);
    html.classList.toggle('dark', saved === 'dark');
  }
}