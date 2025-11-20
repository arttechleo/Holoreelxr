// src/auth/AuthManager.ts
export type AuthProvider = 'google' | 'meta' | 'guest';

export interface User {
  id: string;
  name: string;
  email?: string;
  provider: AuthProvider;
  avatar?: string;
}

export class AuthManager {
  private currentUser: User | null = null;
  private listeners: ((user: User | null) => void)[] = [];

  constructor() {
    this.loadFromStorage();
  }

  // Sign in with Google
  async signInWithGoogle(): Promise<User> {
    // TODO: Implement Google OAuth
    // For now, mock implementation
    const user: User = {
      id: `google-${Date.now()}`,
      name: 'Google User',
      email: 'user@gmail.com',
      provider: 'google',
    };
    this.setUser(user);
    return user;
  }

  // Sign in with Meta
  async signInWithMeta(): Promise<User> {
    // TODO: Implement Meta OAuth
    // For now, mock implementation
    const user: User = {
      id: `meta-${Date.now()}`,
      name: 'Meta User',
      email: 'user@meta.com',
      provider: 'meta',
    };
    this.setUser(user);
    return user;
  }

  // Continue as guest
  signInAsGuest(): User {
    const user: User = {
      id: `guest-${Date.now()}`,
      name: 'Guest',
      provider: 'guest',
    };
    this.setUser(user);
    return user;
  }

  // Sign out
  signOut() {
    this.currentUser = null;
    this.saveToStorage();
    this.notifyListeners();
  }

  // Get current user
  getCurrentUser(): User | null {
    return this.currentUser;
  }

  // Check if signed in
  isSignedIn(): boolean {
    return this.currentUser !== null && this.currentUser.provider !== 'guest';
  }

  // Subscribe to auth changes
  onAuthChange(callback: (user: User | null) => void) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private setUser(user: User) {
    this.currentUser = user;
    this.saveToStorage();
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb(this.currentUser));
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('holoreel_user');
      if (stored) {
        this.currentUser = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load user from storage', e);
    }
  }

  private saveToStorage() {
    try {
      if (this.currentUser) {
        localStorage.setItem('holoreel_user', JSON.stringify(this.currentUser));
      } else {
        localStorage.removeItem('holoreel_user');
      }
    } catch (e) {
      console.warn('Failed to save user to storage', e);
    }
  }
}

