import { Injectable, computed, inject, signal } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { Api } from './api.service';

export interface AuthUser {
  id: number;
  username: string;
  email?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  groups: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(Api);

  private authedSubject = new BehaviorSubject<boolean>(false);
  private userSubject = new BehaviorSubject<AuthUser | null>(null);

  // ✅ única fuente para roles/guards (signal)
  me = signal<AuthUser | null>(null);

  isAuthenticated$ = this.authedSubject.asObservable();
  user$ = this.userSubject.asObservable();

  isStaff = computed(() => !!this.me()?.is_staff);
  groups = computed(() => this.me()?.groups ?? []);

  isAuthenticated(): boolean { return this.authedSubject.value; }
  get user(): AuthUser | null { return this.userSubject.value; }

  /** Intenta restaurar sesión desde cookies (me). No rompe si no hay sesión. */
  ensureSession(): Observable<boolean> {
    // ✅ si ya tengo sesión, sincronizo signal por si acaso
    if (this.authedSubject.value && this.userSubject.value) {
      this.me.set(this.userSubject.value);
      return of(true);
    }

    return this.api.get<AuthUser>('/auth/me/').pipe(
      tap(u => {
        this.userSubject.next(u);
        this.authedSubject.next(true);
        this.me.set(u); // ✅ CLAVE
      }),
      map(() => true),
      catchError(() => {
        this.userSubject.next(null);
        this.authedSubject.next(false);
        this.me.set(null); // ✅ CLAVE
        return of(false);
      })
    );
  }

  /** Llama CSRF -> login -> me, y marca autenticado. */
  login(username: string, password: string) {
    return this.api.get('/auth/csrf/').pipe(
      switchMap(() => this.api.post('/auth/login/', { username, password })),
      switchMap(() => this.api.get<AuthUser>('/auth/me/')),
      tap(u => {
        this.userSubject.next(u);
        this.authedSubject.next(true);
        this.me.set(u); // ✅ CLAVE
      })
    );
  }

  /** Útil si quieres refrescar el usuario manualmente */
  loadMe() {
    return this.api.get<AuthUser>('/auth/me/').pipe(
      tap(u => {
        this.userSubject.next(u);
        this.authedSubject.next(true);
        this.me.set(u);
      }),
      catchError(() => {
        this.userSubject.next(null);
        this.authedSubject.next(false);
        this.me.set(null);
        return of(null);
      })
    );
  }

  /** staff pasa siempre; si no, debe pertenecer a alguno de los grupos allowed */
  canAny(allowed: string[]) {
    if (this.isStaff()) return true;
    const gs = this.groups();
    return allowed.some(r => gs.includes(r));
  }

  logout() {
    return this.api.post('/auth/logout/', {}).pipe(
      tap(() => {
        this.userSubject.next(null);
        this.authedSubject.next(false);
        this.me.set(null); // ✅ CLAVE
      })
    );
  }
}
