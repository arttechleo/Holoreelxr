// src/feed/loaders/GaussianSplatLoader.ts
import * as THREE from 'three';
import { retry, logError, AssetLoadError } from '../../utils/errors';
import { logger } from '../../config/production';
import { html, css, js } from '@playcanvas/supersplat-viewer';

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
 * Three.js/WebXR feed, we create a container that holds the viewer HTML/CSS/JS.
 * 
 * Current Implementation:
 * - Uses an iframe with a blob URL containing the viewer HTML
 * - This ensures isolation and doesn't interfere with our Three.js scene
 * - The viewer renders to its own canvas within the iframe
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
        
        // Create blob URL with the viewer HTML
        // Modify the HTML to use our URLs
        let viewerHtml = html;
        
        // Replace the script that sets up URLs
        const scriptMatch = viewerHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
        if (scriptMatch) {
          const newScript = `
            <script type="module">
              const url = new URL(location.href);
              const settingsUrl = url.searchParams.get('settings') || '${settingsUrl || './settings.json'}';
              const contentUrl = url.searchParams.get('content') || '${url}';
              const params = {};
              
              // Apply URL parameter overrides
              if (url.searchParams.has('noui')) params.noui = true;
              if (url.searchParams.has('noanim')) params.noanim = true;
              if (url.searchParams.has('poster')) params.posterUrl = url.searchParams.get('poster');
              if (url.searchParams.has('skybox')) params.skyboxUrl = url.searchParams.get('skybox');
              if (url.searchParams.has('ministats')) params.ministats = true;
              
              const createImage = (url) => {
                const img = new Image();
                img.src = url;
                return img;
              };
              
              window.sse = {
                poster: params.posterUrl && createImage(params.posterUrl),
                settings: fetch(settingsUrl).then(response => response.json()),
                contentUrl,
                contents: fetch(contentUrl),
                params: { ...params, noui: true } // Always hide UI for embedded use
              };
            </script>
          `;
          viewerHtml = viewerHtml.replace(/<script type="module">[\s\S]*?<\/script>/, newScript);
        }
        
        // Inject CSS
        viewerHtml = viewerHtml.replace('</head>', `<style>${css}</style></head>`);
        
        // Inject main JS before closing body
        viewerHtml = viewerHtml.replace('</body>', `<script type="module">${js}</script></body>`);
        
        // Create blob URL
        const blob = new Blob([viewerHtml], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        
        // Set iframe src with URL parameters
        const iframeUrl = new URL(blobUrl);
        iframeUrl.searchParams.set('content', url);
        if (settingsUrl) {
          iframeUrl.searchParams.set('settings', settingsUrl);
        }
        iframeUrl.searchParams.set('noui', 'true');
        
        iframe.src = iframeUrl.toString();
        container.appendChild(iframe);
        
        // Clean up blob URL after iframe loads
        iframe.onload = () => {
          URL.revokeObjectURL(blobUrl);
        };
        
        const asset: GaussianSplatAsset = {
          container,
          canvas: null, // Canvas is inside iframe, not directly accessible
          url,
          settingsUrl,
          dispose: () => {
            if (container.parentNode) {
              container.parentNode.removeChild(container);
            }
            URL.revokeObjectURL(blobUrl);
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
          URL.revokeObjectURL(blobUrl);
          logger.verbose(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
          resolve(asset);
        };

        iframe.onerror = (err) => {
          clearTimeout(timeoutId);
          URL.revokeObjectURL(blobUrl);
          logger.error(`[GaussianSplatLoader] ❌ Load error: ${url}`, err);
          reject(new AssetLoadError('Failed to load Gaussian Splat viewer', url, err));
        };

        // Add to document (hidden initially)
        document.body.appendChild(container);

        // Fallback: resolve after a delay even if onload doesn't fire
        setTimeout(() => {
          if (iframe.contentDocument || iframe.contentWindow) {
            clearTimeout(timeoutId);
            URL.revokeObjectURL(blobUrl);
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
