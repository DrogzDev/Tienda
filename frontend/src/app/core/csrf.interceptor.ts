// src/app/core/csrf.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  // siempre con credenciales (cookies)
  let clone = req.clone({ withCredentials: true });

  const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const csrftoken = getCookie('csrftoken');
  if (unsafe && csrftoken && !clone.headers.has('X-CSRFToken')) {
    clone = clone.clone({ setHeaders: { 'X-CSRFToken': csrftoken } });
  }
  return next(clone);
};
