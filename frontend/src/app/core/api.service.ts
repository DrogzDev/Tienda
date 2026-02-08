// src/app/core/services/api.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class Api {
  // Todo va a http://localhost:4200/api/... y el proxy lo reenvía al backend.
  private base = '/api';

  constructor(private http: HttpClient) {}

  get<T>(url: string, params?: Record<string, any>) {
    let p = new HttpParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined) p = p.set(k, String(v));
      }
    }
    return this.http.get<T>(this.base + url, { params: p, withCredentials: true });
  }

  post<T>(url: string, body: any) {
    return this.http.post<T>(this.base + url, body, { withCredentials: true });
  }

  // 👇 helper específico para FormData (imágenes, archivos)
  postForm<T>(url: string, form: FormData) {
    // No seteamos Content-Type para que el navegador ponga el boundary correcto
    return this.http.post<T>(this.base + url, form, { withCredentials: true });
  }

  patch<T>(url: string, body: any) {
    return this.http.patch<T>(this.base + url, body, { withCredentials: true });
  }

  put<T>(url: string, body: any) {
    return this.http.put<T>(this.base + url, body, { withCredentials: true });
  }

  delete<T>(url: string) {
    return this.http.delete<T>(this.base + url, { withCredentials: true });
  }

  // Para construir links absolutos (PDF, descargas, etc.)
  resolveAbsoluteUrl(path: string) {
    return `${location.origin}${this.base}${path}`;
  }
}
