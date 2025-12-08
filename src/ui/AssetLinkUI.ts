// src/ui/AssetLinkUI.ts
import { AssetLinkManager, AssetLink } from '../feed/AssetLinkManager';

export class AssetLinkUI {
  private manager: AssetLinkManager;
  private container: HTMLElement;
  private onLinkAdded?: (link: AssetLink) => void;

  constructor(manager: AssetLinkManager, containerId = 'asset-link-ui') {
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
  }

  setOnLinkAdded(callback: (link: AssetLink) => void) {
    this.onLinkAdded = callback;
  }

  private render() {
    this.container.classList.add('asset-link-ui-container');
    this.container.innerHTML = `
      <h3 class="asset-link-ui-title">3D Asset Links</h3>
      <div class="asset-link-ui-form">
        <input type="text" id="asset-url-input" class="asset-link-ui-input" placeholder="Paste Sketchfab/Animated/Stale URL...">
        <input type="text" id="asset-title-input" class="asset-link-ui-input" placeholder="Title (optional)">
        <input type="text" id="asset-author-input" class="asset-link-ui-input" placeholder="Author (optional)">
        <button id="add-asset-btn" class="asset-link-ui-button">
          Add Asset
        </button>
      </div>
      <div id="asset-links-list" class="asset-link-ui-list">
      </div>
    `;

    const urlInput = document.getElementById('asset-url-input') as HTMLInputElement;
    const titleInput = document.getElementById('asset-title-input') as HTMLInputElement;
    const authorInput = document.getElementById('asset-author-input') as HTMLInputElement;
    const addBtn = document.getElementById('add-asset-btn') as HTMLButtonElement;

    addBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) return;

      const title = titleInput.value.trim();
      const author = authorInput.value.trim();

      if (this.manager.addLink(url, title || undefined, author || undefined)) {
        urlInput.value = '';
        titleInput.value = '';
        authorInput.value = '';
        this.updateLinksList();
        const links = this.manager.getAllLinks();
        const link = links[links.length - 1];
        if (this.onLinkAdded) this.onLinkAdded(link);
      } else {
        alert('Invalid URL. Supported: Sketchfab, Animated.xyz, Stale, or direct .gltf/.glb links');
      }
    });

    this.updateLinksList();
  }

  private updateLinksList() {
    const listEl = document.getElementById('asset-links-list');
    if (!listEl) return;

    const links = this.manager.getAllLinks();
    if (links.length === 0) {
      listEl.innerHTML = '<p class="asset-link-ui-empty-state">No assets added yet</p>';
      return;
    }

    listEl.innerHTML = links.map(link => `
      <div class="asset-link-ui-item">
        <div class="asset-link-ui-item-content">
          <div class="asset-link-ui-item-title">${link.title}</div>
          <div class="asset-link-ui-item-meta">${link.source} • ${link.author}</div>
          <div class="asset-link-ui-item-url">${link.url}</div>
        </div>
        <button data-link-id="${link.id}" class="asset-link-ui-remove-button">
          Remove
        </button>
      </div>
    `).join('');

    listEl.querySelectorAll('button[data-link-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-link-id');
        if (id && this.manager.removeLink(id)) {
          this.updateLinksList();
        }
      });
    });
  }

  show() {
    this.container.classList.remove('is-hidden');
  }

  hide() {
    this.container.classList.add('is-hidden');
  }
}

