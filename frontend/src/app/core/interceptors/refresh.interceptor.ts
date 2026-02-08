import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest, HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';

const isAuthUrl = (url: string) => url.startsWith('/api/auth/');

export const refreshInterceptor: HttpInterceptorFn = (req: HttpRequest<any>, next: HttpHandlerFn) => {
  const http = inject(HttpClient);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: any) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthUrl(req.url)) {
        // 1) Asegura CSRF, 2) intenta refresh, 3) reintenta la request
        return http.get('/api/auth/csrf/', { withCredentials: true }).pipe(
          switchMap(() => http.post('/api/auth/refresh/', {}, { withCredentials: true })),
          switchMap(() => next(req.clone({ withCredentials: true }))),
          catchError(() => {
            // Si el refresh falla → fuera
            router.navigate(['/login'], { queryParams: { next: location.pathname + location.search } });
            return throwError(() => err);
          })
        );
      }
      return throwError(() => err);
    })
  );
};
