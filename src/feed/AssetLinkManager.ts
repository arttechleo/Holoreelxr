// src/feed/AssetLinkManager.ts
import { FeedStore } from './FeedStore';

export type AssetSource = 'sketchfab' | 'poly' | 'animated' | 'stale' | 'custom';

export interface AssetLink {
  id: string;
  url: string;
  source: AssetSource;
  title?: string;
  author?: string;
}

export class AssetLinkManager {
  private links: AssetLink[] = [];
  private store: FeedStore;

  constructor(store: FeedStore) {
    this.store = store;
    this.loadFromStorage();
  }

  // Parse URL to determine source and extract model ID
  parseUrl(url: string): { source: AssetSource; modelId: string } | null {
    try {
      const u = new URL(url);
      
      // Sketchfab: https://sketchfab.com/models/xxxxx or https://sketchfab.com/3d-models/xxxxx
      if (u.hostname.includes('sketchfab.com')) {
        const match = u.pathname.match(/\/(models|3d-models)\/([^\/]+)/);
        if (match) {
          return { source: 'sketchfab', modelId: match[2] };
        }
      }
      
      // Google Poly (archived but still accessible)
      if (u.hostname.includes('poly.google.com')) {
        const match = u.pathname.match(/\/viewer\/([^\/]+)/);
        if (match) {
          return { source: 'poly', modelId: match[1] };
        }
      }
      
      // Animated.xyz
      if (u.hostname.includes('animated.xyz')) {
        const match = u.pathname.match(/\/([^\/]+)/);
        if (match) {
          return { source: 'animated', modelId: match[1] };
        }
      }
      
      // Stale (placeholder - adjust based on actual API)
      if (u.hostname.includes('stale.com') || u.hostname.includes('stale.io')) {
        const match = u.pathname.match(/\/([^\/]+)/);
        if (match) {
          return { source: 'stale', modelId: match[1] };
        }
      }
      
      // Custom/Generic GLTF/GLB URL
      if (url.endsWith('.gltf') || url.endsWith('.glb')) {
        return { source: 'custom', modelId: url };
      }
      
      return null;
    } catch {
      return null;
    }
  }

  // Get download URL for a source
  getDownloadUrl(source: AssetSource, modelId: string): string {
    switch (source) {
      case 'sketchfab':
        // Sketchfab API endpoint (requires API key in production)
        return `https://api.sketchfab.com/v3/models/${modelId}/download`;
      case 'poly':
        // Google Poly download (may be deprecated)
        return `https://poly.google.com/viewer/${modelId}`;
      case 'animated':
        return `https://animated.xyz/api/models/${modelId}/download`;
      case 'stale':
        return `https://api.stale.com/models/${modelId}/download`;
      case 'custom':
        return modelId; // Already a URL
      default:
        return '';
    }
  }

  // Add asset link
  addLink(url: string, title?: string, author?: string): boolean {
    const parsed = this.parseUrl(url);
    if (!parsed) return false;

    const link: AssetLink = {
      id: `${parsed.source}-${parsed.modelId}-${Date.now()}`,
      url,
      source: parsed.source,
      title: title || 'Untitled',
      author: author || 'Unknown',
    };

    this.links.push(link);
    this.saveToStorage();
    return true;
  }

  // Remove asset link
  removeLink(id: string): boolean {
    const idx = this.links.findIndex(l => l.id === id);
    if (idx === -1) return false;
    this.links.splice(idx, 1);
    this.saveToStorage();
    return true;
  }

  // Get all links
  getAllLinks(): AssetLink[] {
    return [...this.links];
  }

  // Load links from localStorage
  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('holoreel_asset_links');
      if (stored) {
        this.links = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load asset links from storage', e);
    }
  }

  // Save links to localStorage
  private saveToStorage() {
    try {
      localStorage.setItem('holoreel_asset_links', JSON.stringify(this.links));
    } catch (e) {
      console.warn('Failed to save asset links to storage', e);
    }
  }

  // Convert links to feed items
  getFeedItems() {
    return this.links.map(link => {
      const parsed = this.parseUrl(link.url);
      const downloadUrl = parsed ? this.getDownloadUrl(parsed.source, parsed.modelId) : link.url;
      return {
        id: link.id,
        title: link.title || 'Untitled',
        author: link.author || 'Unknown',
        type: 'mesh' as const,
        src: downloadUrl,
      };
    });
  }
}

