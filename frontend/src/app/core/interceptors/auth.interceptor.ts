// src/app/core/auth.interceptor.ts
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';

let refreshInFlight = false;
const refreshDone$ = new BehaviorSubject<boolean>(true);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const http = inject(HttpClient);

  // Siempre enviar cookies
  req = req.clone({ withCredentials: true });

  // No interceptar endpoints de auth ni OPTIONS
  const isAuthUrl = req.url.startsWith('/api/auth/');
  if (isAuthUrl || req.method === 'OPTIONS') {
    return next(req);
  }

  return next(req).pipe(
    catchError((err: any) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        // Si ya se está refrescando, espera a que termine y reintenta
        if (refreshInFlight) {
          return refreshDone$.pipe(
            filter(v => v === true),
            take(1),
            switchMap(() => next(req.clone({ withCredentials: true })))
          );
        }

        // Lanzar refresh
        refreshInFlight = true;
        refreshDone$.next(false);

        return http.post('/api/auth/refresh/', {}, { withCredentials: true }).pipe(
          switchMap(() => {
            refreshInFlight = false;
            refreshDone$.next(true);
            // Reintentar la petición original
            return next(req.clone({ withCredentials: true }));
          }),
          catchError(refreshErr => {
            refreshInFlight = false;
            refreshDone$.next(true);
            // Limpia cookies en servidor (opcional) y fuerza login
            http.post('/api/auth/logout/', {}, { withCredentials: true }).subscribe({ next: () => {}, error: () => {} });
            // Redirige al login
            location.href = '/login';
            return throwError(() => refreshErr);
          })
        );
      }
      return throwError(() => err);
    })
  );
};
