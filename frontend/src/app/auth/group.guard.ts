import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

export const groupGuard = (allowed: string[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    // ✅ Staff bypass (is_staff)
    if (auth.isStaff?.() === true) {
      return true;
    }

    // ✅ Grupos permitidos (VENDEDOR, etc.)
    if (auth.canAny(allowed)) {
      return true;
    }

    router.navigate(['/home']);
    return false;
  };
};
