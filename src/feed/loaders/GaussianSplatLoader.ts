// src/feed/loaders/GaussianSplatLoader.ts
import * as THREE from 'three';
import { retry, logError, AssetLoadError } from '../../utils/errors';
import { logger } from '../../config/production';

/**
 * Gaussian Splat asset representation.
 * The supersplat-viewer uses PlayCanvas and renders to its own canvas.
 * We wrap it in a container that can be positioned and shown/hidden.
 */
export type GaussianSplatAsset = {
  // Container element that holds the PlayCanvas viewer
  container: HTMLElement;
  // Canvas element where the splat is rendered (from PlayCanvas app)
  canvas: HTMLCanvasElement | null;
  // URL of the loaded splat file
  url: string;
  // Optional settings URL
  settingsUrl?: string;
  // Cleanup function
  dispose: () => void;
  // Show/hide the viewer
  show: () => void;
  hide: () => void;
};

/**
 * Loader for Gaussian Splat content using @playcanvas/supersplat-viewer.
 * 
 * Architecture Decision:
 * The supersplat-viewer is a PlayCanvas-based standalone app. For integration into our
 * Three.js/WebXR feed, we use a static viewer served from the same origin.
 * 
 * Implementation:
 * - Uses an iframe pointing to a static viewer at /supersplat/index.html
 * - This avoids blob URL security issues in production environments
 * - The viewer renders to its own canvas within the iframe
 * - URL parameters are used to pass the content URL and settings
 * 
 * Future Enhancement:
 * - Full XR integration would require syncing PlayCanvas camera with XR session
 * - Could extract PlayCanvas app and integrate directly into our render loop
 * - For now, this overlay approach works for both desktop and XR (as a 2D overlay)
 */
export class GaussianSplatLoader {
  private cache = new Map<string, Promise<GaussianSplatAsset>>();
  private disposed = false;

  constructor() {
    // Initialize any required setup
  }

  /**
   * Load a Gaussian Splat asset from a URL.
   * Returns a container element that can be positioned in the scene.
   */
  async load(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    const cacheKey = `${url}:${settingsUrl || 'default'}`;
    const base = await this.fetchOrCache(cacheKey, url, settingsUrl);
    // For now, return the base asset directly (cloning is complex for PlayCanvas apps)
    return base;
  }

  /**
   * Preload an asset into the cache.
   * Safe to call multiple times – only the first call performs network I/O.
   */
  async preload(url: string, settingsUrl?: string): Promise<void> {
    const cacheKey = `${url}:${settingsUrl || 'default'}`;
    await this.fetchOrCache(cacheKey, url, settingsUrl);
  }

  private async fetchOrCache(
    cacheKey: string,
    url: string,
    settingsUrl?: string
  ): Promise<GaussianSplatAsset> {
    if (this.disposed) {
      throw new Error('GaussianSplatLoader is disposed');
    }

    let cached = this.cache.get(cacheKey);
    if (!cached) {
      logger.verbose(`[GaussianSplatLoader] Starting new load (not cached): ${url}`);
      cached = retry(() => this.loadSplat(cacheKey, url, settingsUrl), {
        maxAttempts: 3,
        delayMs: 500,
        onRetry: (attempt, error) => {
          logger.warn(`[GaussianSplatLoader] Retry ${attempt}/3 loading ${url}:`, error);
        },
      }).then((asset) => {
        logger.verbose(`[GaussianSplatLoader] ✅ Successfully cached: ${url}`);
        return asset;
      }).catch(error => {
        logger.error(`[GaussianSplatLoader] ❌ All retry attempts failed for: ${url}`, error);
        this.cache.delete(cacheKey);
        throw error;
      });

      this.cache.set(cacheKey, cached);
    } else {
      logger.verbose(`[GaussianSplatLoader] Using cached splat: ${url}`);
    }

    return cached;
  }

  private async loadSplat(
    cacheKey: string,
    url: string,
    settingsUrl?: string
  ): Promise<GaussianSplatAsset> {
    logger.verbose(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        logger.error(`[GaussianSplatLoader] ❌ Load timeout after 30s: ${url}`);
        reject(new AssetLoadError(`Load timeout after 30s`, url));
      }, 30000);

      try {
        // Create a container element for the viewer
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.top = '0';
        container.style.left = '0';
        container.style.pointerEvents = 'auto';
        container.style.zIndex = '2'; // Above background, below UI overlays
        container.style.visibility = 'hidden';
        container.style.opacity = '0';
        container.style.transition = 'opacity 0.3s ease-in-out';
        
        // Create iframe to host the viewer (isolated from our Three.js context)
        const iframe = document.createElement('iframe');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.background = 'transparent';
        
        // Use static viewer URL instead of blob URL to avoid SecurityError in production
        // The viewer is served from /supersplat/index.html (same origin, CSP-friendly)
        const viewerBaseUrl = '/supersplat/index.html';
        const viewerUrl = new URL(viewerBaseUrl, window.location.origin);
        viewerUrl.searchParams.set('content', url);
        if (settingsUrl) {
          viewerUrl.searchParams.set('settings', settingsUrl);
        }
        viewerUrl.searchParams.set('noui', 'true');
        
        iframe.src = viewerUrl.toString();
        iframe.allow = 'fullscreen; xr-spatial-tracking; vr; webxr;';
        
        container.appendChild(iframe);
        
        const asset: GaussianSplatAsset = {
          container,
          canvas: null, // Canvas is inside iframe, not directly accessible
          url,
          settingsUrl,
          dispose: () => {
            if (container.parentNode) {
              container.parentNode.removeChild(container);
            }
          },
          show: () => {
            container.style.visibility = 'visible';
            container.style.opacity = '1';
          },
          hide: () => {
            container.style.opacity = '0';
            setTimeout(() => {
              container.style.visibility = 'hidden';
            }, 300);
          },
        };

        // Wait for iframe to load
        iframe.onload = () => {
          clearTimeout(timeoutId);
          logger.verbose(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
          resolve(asset);
        };

        iframe.onerror = (err) => {
          clearTimeout(timeoutId);
          logger.error(`[GaussianSplatLoader] ❌ Load error: ${url}`, err);
          logger.error(`[GaussianSplatLoader] Viewer URL: ${viewerUrl.toString()}`);
          reject(new AssetLoadError('Failed to load Gaussian Splat viewer', url, err));
        };

        // Add to document (hidden initially)
        document.body.appendChild(container);

        // Fallback: resolve after a delay even if onload doesn't fire
        setTimeout(() => {
          if (iframe.contentDocument || iframe.contentWindow) {
            clearTimeout(timeoutId);
            logger.verbose(`[GaussianSplatLoader] ✅ Load successful (fallback): ${url}`);
            resolve(asset);
          }
        }, 3000);

      } catch (e) {
        clearTimeout(timeoutId);
        logger.error(`[GaussianSplatLoader] ❌ Failed to create viewer: ${url}`, e);
        reject(new AssetLoadError('Failed to create Gaussian Splat viewer', url, e));
      }
    });
  }

  dispose() {
    this.disposed = true;
    // Dispose all cached assets
    this.cache.forEach(async (promise) => {
      try {
        const asset = await promise;
        asset.dispose();
      } catch (e) {
        // Ignore errors during disposal
      }
    });
    this.cache.clear();
  }
}
