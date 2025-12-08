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
    // Hide auth UI in main feed (disabled in main.ts)
    this.container.classList.add('auth-ui-container', 'is-hidden-in-main-feed');
    this.container.innerHTML = `
      <div id="auth-content"></div>
    `;
    this.updateUI();
  }

  private updateUI() {
    const content = this.container.querySelector('#auth-content');
    if (!content) return;

    const user = this.manager.getCurrentUser();
    
    if (user) {
      content.innerHTML = `
        <div class="auth-ui-user-info">
          <div class="auth-ui-user-name">${user.name}</div>
          <div class="auth-ui-user-provider">${user.provider === 'guest' ? 'Guest' : user.provider}</div>
          ${user.email ? `<div class="auth-ui-user-email">${user.email}</div>` : ''}
        </div>
        <button id="sign-out-btn" class="auth-ui-button auth-ui-button--signout">
          Sign Out
        </button>
      `;
      (content.querySelector('#sign-out-btn') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.signOut();
      });
    } else {
      content.innerHTML = `
        <h3 class="auth-ui-title">Sign In</h3>
        <button id="sign-in-google" class="auth-ui-button auth-ui-button--google">
          Sign in with Google
        </button>
        <button id="sign-in-meta" class="auth-ui-button auth-ui-button--meta">
          Sign in with Meta
        </button>
        <button id="sign-in-guest" class="auth-ui-button auth-ui-button--guest">
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
    this.container.classList.remove('is-hidden');
  }

  hide() {
    this.container.classList.add('is-hidden');
  }
}

