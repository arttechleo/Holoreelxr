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
    this.container.innerHTML = `
      <div style="position: fixed; top: 20px; right: 20px; background: rgba(0,0,0,0.9); color: white; padding: 20px; border-radius: 8px; max-width: 400px; z-index: 10000; font-family: sans-serif;">
        <h3 style="margin: 0 0 15px 0;">3D Asset Links</h3>
        <div style="margin-bottom: 15px;">
          <input type="text" id="asset-url-input" placeholder="Paste Sketchfab/Animated/Stale URL..." 
                 style="width: 100%; padding: 8px; border: 1px solid #555; background: #222; color: white; border-radius: 4px; margin-bottom: 8px;">
          <input type="text" id="asset-title-input" placeholder="Title (optional)" 
                 style="width: 100%; padding: 8px; border: 1px solid #555; background: #222; color: white; border-radius: 4px; margin-bottom: 8px;">
          <input type="text" id="asset-author-input" placeholder="Author (optional)" 
                 style="width: 100%; padding: 8px; border: 1px solid #555; background: #222; color: white; border-radius: 4px; margin-bottom: 8px;">
          <button id="add-asset-btn" 
                  style="width: 100%; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Add Asset
          </button>
        </div>
        <div id="asset-links-list" style="max-height: 300px; overflow-y: auto;">
        </div>
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
      listEl.innerHTML = '<p style="color: #888; font-size: 12px;">No assets added yet</p>';
      return;
    }

    listEl.innerHTML = links.map(link => `
      <div style="padding: 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1;">
          <div style="font-weight: bold; margin-bottom: 4px;">${link.title}</div>
          <div style="font-size: 11px; color: #aaa;">${link.source} • ${link.author}</div>
          <div style="font-size: 10px; color: #666; word-break: break-all;">${link.url}</div>
        </div>
        <button data-link-id="${link.id}" 
                style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px;">
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
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }
}

