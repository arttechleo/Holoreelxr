// src/ui/AuthUI.ts
import { AuthManager, User } from '../auth/AuthManager';

export class AuthUI {
  private manager: AuthManager;
  private container: HTMLElement;
  private onUserChanged?: (user: User | null) => void;

  constructor(manager: AuthManager, containerId = 'auth-ui') {
    this.manager = manager;
    const el = document.getElementById(containerId);
    if (!el) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      document.body.appendChild(this.container);
    } else {
      this.container = el;
    }
    this.render();
    this.manager.onAuthChange((user) => {
      this.updateUI();
      if (this.onUserChanged) this.onUserChanged(user);
    });
  }

  setOnUserChanged(callback: (user: User | null) => void) {
    this.onUserChanged = callback;
  }

  private render() {
    this.container.innerHTML = `
      <div style="position: fixed; top: 20px; left: 20px; background: rgba(0,0,0,0.9); color: white; padding: 20px; border-radius: 8px; z-index: 10000; font-family: sans-serif; min-width: 250px;">
        <div id="auth-content"></div>
      </div>
    `;
    this.updateUI();
  }

  private updateUI() {
    const content = this.container.querySelector('#auth-content');
    if (!content) return;

    const user = this.manager.getCurrentUser();
    
    if (user) {
      content.innerHTML = `
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; margin-bottom: 5px;">${user.name}</div>
          <div style="font-size: 12px; color: #aaa;">${user.provider === 'guest' ? 'Guest' : user.provider}</div>
          ${user.email ? `<div style="font-size: 11px; color: #888;">${user.email}</div>` : ''}
        </div>
        <button id="sign-out-btn" 
                style="width: 100%; padding: 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Sign Out
        </button>
      `;
      (content.querySelector('#sign-out-btn') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.signOut();
      });
    } else {
      content.innerHTML = `
        <h3 style="margin: 0 0 15px 0;">Sign In</h3>
        <button id="sign-in-google" 
                style="width: 100%; padding: 10px; background: #4285F4; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 8px;">
          Sign in with Google
        </button>
        <button id="sign-in-meta" 
                style="width: 100%; padding: 10px; background: #0081FB; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 8px;">
          Sign in with Meta
        </button>
        <button id="sign-in-guest" 
                style="width: 100%; padding: 10px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Continue as Guest
        </button>
      `;
      (content.querySelector('#sign-in-google') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.signInWithGoogle();
      });
      (content.querySelector('#sign-in-meta') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.signInWithMeta();
      });
      (content.querySelector('#sign-in-guest') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.signInAsGuest();
      });
    }
  }

  show() {
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }
}

