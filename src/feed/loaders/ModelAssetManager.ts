// src/feed/loaders/ModelAssetManager.ts
import * as THREE from 'three';
import { GLTFModelLoader, type GLTFAsset } from './GLTFLoader';
import { logger } from '../../config/production';

export interface AssetStatus {
  state: 'idle' | 'loading' | 'loaded' | 'error';
  error?: Error;
}

type AssetState = {
  status: AssetStatus;
  promise?: Promise<GLTFAsset>;
  priority: 'high' | 'low';
};

/**
 * High-level manager for GLTF/GLB asset loading with:
 * - Per-URL state tracking (idle | loading | loaded | error)
 * - Concurrency limits for network I/O
 * - Priority-based loading (high-priority for immediate display, low-priority for preloading)
 * - Background preloading support
 */
export class ModelAssetManager {
  private loader: GLTFModelLoader;
  private states = new Map<string, AssetState>();
  private loadingQueue: Array<{ url: string; priority: 'high' | 'low'; resolve: (asset: GLTFAsset) => void; reject: (err: Error) => void }> = [];
  private activeLoads = 0;
  private maxConcurrentLoads: number;
  private disposed = false;

  constructor(maxConcurrentLoads = 3) {
    this.loader = new GLTFModelLoader();
    this.maxConcurrentLoads = maxConcurrentLoads;
  }

  /**
   * Get the current status of an asset by URL
   */
  getStatus(url: string): AssetStatus {
    const state = this.states.get(url);
    if (!state) {
      return { state: 'idle' };
    }
    return state.status;
  }

  /**
   * Load an asset with high priority (for immediate display).
   * Returns a cloned scene that can be safely added to the scene.
   */
  async loadNow(url: string): Promise<GLTFAsset> {
    if (this.disposed) {
      throw new Error('ModelAssetManager is disposed');
    }

    const existing = this.states.get(url);
    
    // If already loaded, return immediately (cloned)
    if (existing?.status.state === 'loaded') {
      logger.verbose(`[ModelAssetManager] Using cached asset: ${url}`);
      return this.loader.load(url); // This will clone the cached asset
    }

    // If currently loading, wait for it and then clone
    if (existing?.status.state === 'loading' && existing.promise) {
      logger.verbose(`[ModelAssetManager] Waiting for in-progress load: ${url}`);
      await existing.promise; // Wait for load to complete
      return this.loader.load(url); // Clone the now-loaded asset
    }

    // If error state, clear it and retry
    if (existing?.status.state === 'error') {
      logger.verbose(`[ModelAssetManager] Retrying after error: ${url}`);
      this.states.delete(url);
    }

    // Start a high-priority load
    return this.startLoad(url, 'high');
  }

  /**
   * Preload an asset with low priority (background loading).
   * Safe to call multiple times - only the first call performs network I/O.
   */
  async preload(url: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    const existing = this.states.get(url);
    
    // Already loaded or loading - nothing to do
    if (existing?.status.state === 'loaded' || existing?.status.state === 'loading') {
      return;
    }

    // If error state, clear it and retry
    if (existing?.status.state === 'error') {
      this.states.delete(url);
    }

    // Start a low-priority preload (fire-and-forget)
    this.startLoad(url, 'low').catch(err => {
      // Silently handle preload errors - they're not critical
      logger.verbose(`[ModelAssetManager] Preload failed (non-critical): ${url}`, err);
    });
  }

  /**
   * Preload multiple URLs with concurrency limits.
   * Fire-and-forget - errors are logged but don't throw.
   */
  async preloadMany(urls: string[]): Promise<void> {
    if (this.disposed || urls.length === 0) {
      return;
    }

    // Filter out already loaded/loading URLs
    const toPreload = urls.filter(url => {
      const status = this.getStatus(url);
      return status.state === 'idle' || status.state === 'error';
    });

    if (toPreload.length === 0) {
      return;
    }

    // Only log if there are significant items to preload (avoid spam)
    if (toPreload.length >= 2) {
      logger.verbose(`[ModelAssetManager] Preloading ${toPreload.length} assets`);
    }

    // Start preloading all of them (concurrency is handled internally)
    await Promise.allSettled(
      toPreload.map(url => this.preload(url))
    );
  }

  /**
   * Internal: Start loading an asset with the given priority
   */
  private async startLoad(url: string, priority: 'high' | 'low'): Promise<GLTFAsset> {
    // Check if we can start immediately or need to queue
    if (this.activeLoads >= this.maxConcurrentLoads) {
      // Queue the request
      return new Promise<GLTFAsset>((resolve, reject) => {
        this.loadingQueue.push({ url, priority, resolve, reject });
        this.processQueue();
      });
    }

    // Start loading immediately
    return this.executeLoad(url, priority);
  }

  /**
   * Internal: Execute the actual load
   */
  private async executeLoad(url: string, priority: 'high' | 'low'): Promise<GLTFAsset> {
    // Mark as loading
    const state: AssetState = {
      status: { state: 'loading' },
      priority,
    };
    this.states.set(url, state);
    this.activeLoads++;

    // Only log high-priority loads to avoid spam from preloads
    if (priority === 'high') {
      logger.verbose(`[ModelAssetManager] 🔄 Loading: ${url}`);
    }

    try {
      // Use the underlying loader
      const asset = await this.loader.load(url);
      
      // Mark as loaded
      state.status = { state: 'loaded' };
      state.promise = Promise.resolve(asset);
      
      // Only log high-priority loads (preloads are silent)
      if (priority === 'high') {
        logger.verbose(`[ModelAssetManager] ✅ Loaded: ${url}`);
      }

      // Process queue to start next load
      this.activeLoads--;
      this.processQueue();

      return asset;
    } catch (error) {
      // Mark as error
      const err = error instanceof Error ? error : new Error(String(error));
      state.status = { state: 'error', error: err };
      state.promise = undefined;
      
      logger.error(`[ModelAssetManager] ❌ Load failed: ${url}`, err);
      
      // Process queue to start next load
      this.activeLoads--;
      this.processQueue();

      throw error;
    }
  }

  /**
   * Internal: Process the loading queue
   */
  private processQueue(): void {
    if (this.disposed) {
      // Reject all queued items
      while (this.loadingQueue.length > 0) {
        const item = this.loadingQueue.shift()!;
        item.reject(new Error('ModelAssetManager is disposed'));
      }
      return;
    }

    // Process queue: prioritize high-priority items, then low-priority
    while (this.activeLoads < this.maxConcurrentLoads && this.loadingQueue.length > 0) {
      // Find highest priority item (high priority first)
      let bestIndex = -1;
      for (let i = 0; i < this.loadingQueue.length; i++) {
        if (this.loadingQueue[i].priority === 'high') {
          bestIndex = i;
          break;
        }
      }
      
      // If no high-priority, take first low-priority
      if (bestIndex === -1) {
        bestIndex = 0;
      }

      const item = this.loadingQueue.splice(bestIndex, 1)[0];
      
      // Start loading
      this.executeLoad(item.url, item.priority)
        .then(asset => item.resolve(asset))
        .catch(err => item.reject(err instanceof Error ? err : new Error(String(err))));
    }
  }

  /**
   * Dispose the manager and underlying loader
   */
  dispose(): void {
    this.disposed = true;
    
    // Reject all queued items
    while (this.loadingQueue.length > 0) {
      const item = this.loadingQueue.shift()!;
      item.reject(new Error('ModelAssetManager is disposed'));
    }
    
    // Clear states
    this.states.clear();
    this.activeLoads = 0;
    
    // Dispose underlying loader
    this.loader.dispose();
  }

  /**
   * Get the underlying GLTFModelLoader (for backward compatibility)
   */
  getLoader(): GLTFModelLoader {
    return this.loader;
  }
}

