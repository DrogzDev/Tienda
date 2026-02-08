import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { Api } from './api.service';

export interface AuthUser {
  id: number;
  username: string;
  email?: string;
  is_staff?: boolean;
  is_superuser?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(Api);

  private authedSubject = new BehaviorSubject<boolean>(false);
  private userSubject = new BehaviorSubject<AuthUser | null>(null);

  isAuthenticated$ = this.authedSubject.asObservable();
  user$ = this.userSubject.asObservable();

  isAuthenticated(): boolean { return this.authedSubject.value; }
  get user(): AuthUser | null { return this.userSubject.value; }

  /** Intenta restaurar sesión desde cookies (me). No rompe si no hay sesión. */
  ensureSession(): Observable<boolean> {
    if (this.authedSubject.value && this.userSubject.value) {
      return of(true);
    }
    return this.api.get<AuthUser>('/auth/me/').pipe(
      tap(u => { this.userSubject.next(u); this.authedSubject.next(true); }),
      map(() => true),
      catchError(() => {
        this.userSubject.next(null);
        this.authedSubject.next(false);
        return of(false);
      })
    );
  }

  /** Llama CSRF -> login -> me, y marca autenticado. */
  login(username: string, password: string) {
    return this.api.get('/auth/csrf/').pipe(
      switchMap(() => this.api.post('/auth/login/', { username, password })),
      switchMap(() => this.api.get<AuthUser>('/auth/me/')),
      tap(u => { this.userSubject.next(u); this.authedSubject.next(true); })
    );
  }

  logout() {
    return this.api.post('/auth/logout/', {}).pipe(
      tap(() => { this.userSubject.next(null); this.authedSubject.next(false); })
    );
  }
}
