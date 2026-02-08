// Estado unificado del sidebar/hamburguer como en home
export abstract class SidebarState {
    sidebarCollapsed = (localStorage.getItem('sidebarCollapsed') ?? '0') === '1';
    sidebarOpen = false; // móvil
  
    toggleCollapse(): void {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      try { localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed ? '1' : '0'); } catch {}
    }
  
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen;
    }
  }
  