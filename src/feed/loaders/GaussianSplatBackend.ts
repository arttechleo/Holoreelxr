// src/feed/loaders/GaussianSplatBackend.ts
/**
 * Abstraction layer for Gaussian Splat rendering backends.
 * 
 * This allows switching between different Gaussian Splat libraries
 * (e.g. Spark, GaussianSplats3D) without changing the rest of the codebase.
 * 
 * Usage:
 *   const backend = createGaussianSplatBackend('spark'); // or 'gaussian-splats-3d'
 *   const asset = await backend.loadSplat('/assets/splat.ply');
 *   scene.add(asset.scene);
 */

import * as THREE from 'three';
import { logger } from '../../config/production';

import { GAUSSIAN_SPLAT } from '../../config/constants';

/**
 * Configuration for Gaussian Splat backend selection.
 * Set via environment variable VITE_GAUSSIAN_BACKEND or use default from constants.
 */
export const GAUSSIAN_BACKEND: 'spark' | 'gaussian-splats-3d' = 
  GAUSSIAN_SPLAT.BACKEND;

/**
 * Result of loading a Gaussian Splat asset.
 * All backends return this consistent format.
 */
export interface GaussianSplatAsset {
  scene: THREE.Object3D; // Can be added directly to Three.js scene
  url: string;
  dispose?: () => void; // Optional cleanup method
}

/**
 * Interface that all Gaussian Splat backends must implement.
 */
export interface IGaussianSplatBackend {
  /**
   * Load a Gaussian Splat from a URL.
   * Returns a Three.js object that can be added to the scene.
   */
  loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset>;
  
  /**
   * Preload a splat for faster subsequent loading.
   */
  preloadSplat(url: string, settingsUrl?: string): Promise<void>;
  
  /**
   * Dispose of resources and cleanup.
   */
  dispose(): void;
  
  /**
   * Get the backend name (for debugging).
   */
  getName(): string;
}

/**
 * Internal factory that creates a backend without optimization wrapper.
 * Used by the optimized wrapper to avoid infinite recursion.
 * @internal
 */
export function createLegacyBackendInternal(): IGaussianSplatBackend {
  const backend = GAUSSIAN_BACKEND;
  console.log(`[GaussianSplatBackend] Creating backend: ${backend}`);
  
  switch (backend) {
    case 'spark':
      return new SparkGaussianSplatBackend();
    case 'gaussian-splats-3d':
      return new GaussianSplats3DBackend();
    default:
      console.warn(`[GaussianSplatBackend] Unknown backend "${backend}", falling back to spark`);
      return new SparkGaussianSplatBackend();
  }
}

/**
 * Create a Gaussian Splat backend instance based on configuration.
 * 
 * NOTE: This function always returns the legacy backend.
 * For optimized backends, use createGaussianSplatBackend() from GaussianSplatBackend.optimized.ts
 */
export function createGaussianSplatBackend(): IGaussianSplatBackend {
  // LEGACY PATH: keep the existing implementation exactly as it was
  // (When flag is OFF, behavior must be byte-for-byte equivalent to what it was before)
  return createLegacyBackendInternal();
}

/**
 * Spark (@sparkjsdev/spark) backend implementation.
 * Uses the existing GaussianSplatLoader.
 */
class SparkGaussianSplatBackend implements IGaussianSplatBackend {
  private loader: any; // GaussianSplatLoader instance
  
  constructor() {
    // Lazy load to avoid circular dependencies
    // GaussianSplatLoader will be imported when needed
  }
  
  getName(): string {
    return 'spark';
  }
  
  private async getLoader() {
    if (!this.loader) {
      const { GaussianSplatLoader } = await import('./GaussianSplatLoader');
      this.loader = new GaussianSplatLoader();
    }
    return this.loader;
  }
  
  async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    const loader = await this.getLoader();
    const asset = await loader.load(url, settingsUrl);
    return {
      scene: asset.scene,
      url: asset.url,
      dispose: () => {
        // Spark backend cleanup handled by loader
      }
    };
  }
  
  async preloadSplat(url: string, settingsUrl?: string): Promise<void> {
    const loader = await this.getLoader();
    await loader.preload(url, settingsUrl);
  }
  
  dispose(): void {
    if (this.loader && this.loader.dispose) {
      this.loader.dispose();
    }
    this.loader = null;
  }
}

/**
 * GaussianSplats3D (@mkkellogg/gaussian-splats-3d) backend implementation.
 * 
 * This backend uses @mkkellogg/gaussian-splats-3d which has proven WebXR support
 * and integrates well with Three.js scenes.
 * 
 * Documentation: https://github.com/mkkellogg/GaussianSplats3D
 */
class GaussianSplats3DBackend implements IGaussianSplatBackend {
  private renderer: THREE.WebGLRenderer | null = null;
  private cache = new Map<string, Promise<GaussianSplatAsset>>();
  private SplatLoader: any; // Will be initialized from library
  
  constructor() {
    // Lazy initialization - will load library when first needed
  }
  
  getName(): string {
    return 'gaussian-splats-3d';
  }
  
  private async initializeLoader() {
    if (this.SplatLoader) return;
    
    try {
      // @ts-ignore - Library may not be installed yet
      const module = await import('@mkkellogg/gaussian-splats-3d');
      // GaussianSplats3D exports a SplatLoader class
      // Check common export patterns
      this.SplatLoader = module.SplatLoader || module.default?.SplatLoader || module.default;
      
      if (!this.SplatLoader) {
        throw new Error('SplatLoader not found in @mkkellogg/gaussian-splats-3d');
      }
      
      console.log('[GaussianSplats3DBackend] ✅ Library initialized successfully');
      logger.verbose('[GaussianSplats3DBackend] GaussianSplats3D library initialized');
    } catch (e: any) {
      logger.error('[GaussianSplats3DBackend] Failed to load library. Please install: npm install @mkkellogg/gaussian-splats-3d', e);
      throw new Error('Gaussian Splat library not available. Install with: npm install @mkkellogg/gaussian-splats-3d');
    }
  }
  
  async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    await this.initializeLoader();
    
    const cacheKey = `${url}:${settingsUrl || 'default'}`;
    let cached = this.cache.get(cacheKey);
    
    if (!cached) {
      console.log(`[GaussianSplats3DBackend] 🔄 Loading splat: ${url}`);
      cached = this.loadSplatInternal(url, settingsUrl).then(asset => {
        console.log(`[GaussianSplats3DBackend] ✅ Successfully loaded: ${url}`);
        return asset;
      }).catch(error => {
        console.error(`[GaussianSplats3DBackend] ❌ Failed to load: ${url}`, error);
        this.cache.delete(cacheKey);
        throw error;
      });
      
      this.cache.set(cacheKey, cached);
    } else {
      console.log(`[GaussianSplats3DBackend] Using cached splat: ${url}`);
    }
    
    return cached;
  }
  
  private async loadSplatInternal(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    // GaussianSplats3D API pattern (may vary by version):
    // Option 1: const loader = new SplatLoader();
    //          const splat = await loader.loadFromURL(url, renderer);
    // Option 2: const splat = await SplatLoader.loadFromURL(url, renderer);
    // 
    // The splat object is a Three.js Object3D that can be added to the scene
    // It should work automatically with WebXR since it's a standard Three.js object
    
    if (!this.renderer) {
      // Get renderer from global app instance (set during initialization)
      const app = (window as any).app;
      if (app && app.renderer) {
        this.renderer = app.renderer;
      } else {
        throw new Error('GaussianSplats3D backend requires renderer. Ensure app is initialized.');
      }
    }
    
    // Try different API patterns based on common GaussianSplats3D usage
    let splatObject: THREE.Object3D;
    
    try {
      // Pattern 1: Instance-based loader
      if (typeof this.SplatLoader === 'function' && this.SplatLoader.prototype?.loadFromURL) {
        const loader = new this.SplatLoader();
        splatObject = await loader.loadFromURL(url, this.renderer);
      }
      // Pattern 2: Static method
      else if (typeof this.SplatLoader.loadFromURL === 'function') {
        splatObject = await this.SplatLoader.loadFromURL(url, this.renderer);
      }
      // Pattern 3: Direct load (if SplatLoader is the loader itself)
      else if (typeof this.SplatLoader === 'function') {
        const loader = new this.SplatLoader(this.renderer);
        splatObject = await loader.load(url);
      }
      else {
        throw new Error('Unknown GaussianSplats3D API pattern');
      }
    } catch (apiError: any) {
      console.error('[GaussianSplats3DBackend] API error:', apiError);
      // Log the actual API structure for debugging
      console.error('[GaussianSplats3DBackend] SplatLoader structure:', {
        type: typeof this.SplatLoader,
        hasLoadFromURL: typeof this.SplatLoader?.loadFromURL,
        hasPrototype: !!this.SplatLoader?.prototype,
        keys: Object.keys(this.SplatLoader || {})
      });
      throw new Error(`GaussianSplats3D API error: ${apiError.message}`);
    }
    
    // Wrap in a Group for consistency with other backends
    const group = new THREE.Group();
    group.add(splatObject);
    group.name = 'gaussian-splat-gs3d';
    
    // Normalize scale and position (similar to Spark backend)
    this.normalizeSplat(group);
    
    return {
      scene: group,
      url,
      dispose: () => {
        // GaussianSplats3D cleanup
        if (splatObject && (splatObject as any).dispose) {
          (splatObject as any).dispose();
        }
        group.remove(splatObject);
      }
    };
  }
  
  private normalizeSplat(group: THREE.Group) {
    // Calculate bounding box and normalize scale
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    logger.verbose(`[GaussianSplats3DBackend] Original size: ${maxDim.toFixed(3)}m`);
    
    if (maxDim > 0 && maxDim < 1000) {
      const scale = 1.0 / maxDim;
      group.scale.multiplyScalar(scale);
      logger.verbose(`[GaussianSplats3DBackend] Normalized scale: ${scale.toFixed(3)}x`);
    } else if (maxDim >= 1000) {
      logger.warn(`[GaussianSplats3DBackend] Splat size very large (${maxDim.toFixed(2)}m), skipping normalization`);
    }
    
    // Center model
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    logger.verbose(`[GaussianSplats3DBackend] Centered at: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
  }
  
  async preloadSplat(url: string, settingsUrl?: string): Promise<void> {
    await this.initializeLoader();
    await this.loadSplat(url, settingsUrl); // Preload by loading into cache
  }
  
  dispose(): void {
    // Dispose all cached assets
    for (const [key, promise] of this.cache.entries()) {
      promise.then(asset => {
        if (asset.dispose) {
          asset.dispose();
        }
      }).catch(() => {
        // Ignore errors during disposal
      });
    }
    this.cache.clear();
    this.SplatLoader = null;
  }
}

