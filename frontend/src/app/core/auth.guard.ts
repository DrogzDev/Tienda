import { CanActivateFn, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Intenta restaurar sesión desde cookies si aún no la tenemos en memoria.
  const ok = await firstValueFrom(auth.ensureSession());
  if (ok) return true;

  router.navigate(['/login'], { queryParams: { next: state.url } });
  return false;
};
