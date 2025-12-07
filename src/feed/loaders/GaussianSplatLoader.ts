// src/feed/loaders/GaussianSplatLoader.ts
import * as THREE from 'three';
import { retry, AssetLoadError } from '../../utils/errors';
import { logger } from '../../config/production';

/**
 * Library Choice: @sparkjsdev/spark
 * 
 * Selected because:
 * - Modern, actively maintained (v0.1.10, published 2025-10-25)
 * - Native Three.js integration (no iframes, works directly in our scene)
 * - Supports .ply files (our current format) and other formats (.spz, .splat, .ksplat)
 * - WebXR compatible (designed to work seamlessly with WebXR)
 * - Advanced rendering features and efficient on low-powered devices
 * - MIT license (permissive)
 * - TypeScript-friendly API
 * 
 * Documentation: https://sparkjs.dev
 */

// Type definitions for SparkJS (will be replaced by actual import once installed)
type SparkRenderer = any;
type SplatMesh = any;

/**
 * Gaussian Splat asset representation.
 * Returns a Three.js object that can be added directly to the scene.
 */
export type GaussianSplatAsset = {
  // Three.js object that can be added to scene (similar to GLTFAsset.scene)
  scene: THREE.Group;
  // URL of the loaded splat file
  url: string;
  // Optional settings URL (for future use)
  settingsUrl?: string;
};

/**
 * Loader for Gaussian Splat content using @sparkjsdev/spark.
 * 
 * Architecture:
 * - Loads .ply files directly into Three.js scene using SparkJS
 * - No iframes - integrates directly with our WebXR/Three.js pipeline
 * - Caching and normalization similar to GLTFModelLoader
 * - Returns cloned objects for multiple instances
 * 
 * Note: SparkRenderer must be initialized in ThreeXRApp and added to the scene.
 * This loader only handles loading SplatMesh objects.
 */
export class GaussianSplatLoader {
  private cache = new Map<string, Promise<GaussianSplatAsset>>();
  private disposed = false;
  private SplatMeshClass: any; // Will be initialized from library

  constructor() {
    // Lazy initialization - will load library when first needed
    // This allows the app to work even if library isn't installed yet
  }

  private async initializeLoader() {
    if (this.SplatMeshClass) return;
    
    try {
      // Try to dynamically import the library
      // @ts-ignore - Library may not be installed yet
      const module = await import('@sparkjsdev/spark');
      this.SplatMeshClass = module.SplatMesh || module.default?.SplatMesh;
      if (!this.SplatMeshClass) {
        throw new Error('SplatMesh not found in @sparkjsdev/spark');
      }
      logger.verbose('[GaussianSplatLoader] SparkJS library initialized successfully');
    } catch (e: any) {
      logger.error('[GaussianSplatLoader] Failed to load library. Please install: npm install @sparkjsdev/spark', e);
      throw new Error('Gaussian Splat library not available. Install with: npm install @sparkjsdev/spark');
    }
  }

  /**
   * Load a Gaussian Splat asset from a URL.
   * Returns a deep-cloned scene so it can be safely added to the world
   * without mutating cached assets. Subsequent loads reuse the cached
   * payload and only pay the cost of cloning.
   */
  async load(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    await this.initializeLoader();
    const base = await this.fetchOrCache(url, settingsUrl);
    return this.cloneAsset(base);
  }

  /**
   * Preload an asset into the cache so it is instantly available when needed.
   * Safe to call multiple times – only the first call performs network I/O.
   */
  async preload(url: string, settingsUrl?: string): Promise<void> {
    await this.initializeLoader();
    await this.fetchOrCache(url, settingsUrl);
  }

  private async fetchOrCache(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    if (this.disposed) {
      throw new Error('GaussianSplatLoader is disposed');
    }

    const cacheKey = `${url}:${settingsUrl || 'default'}`;
    let cached = this.cache.get(cacheKey);

    if (!cached) {
      logger.verbose(`[GaussianSplatLoader] Starting new load (not cached): ${url}`);
      cached = retry(() => this.loadSplat(url, settingsUrl), {
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

  private async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    logger.verbose(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        logger.error(`[GaussianSplatLoader] ❌ Load timeout after 30s: ${url}`);
        reject(new AssetLoadError(`Load timeout after 30s`, url));
      }, 30000);

      try {
        // Create SplatMesh using SparkJS API
        // According to SparkJS docs: new SplatMesh({ url: 'path_to_splat_file' })
        const splatMesh = new this.SplatMeshClass({ url });
        
        // Wrap in a Group for consistency with GLTF assets
        const group = new THREE.Group();
        group.add(splatMesh);
        group.name = 'gaussian-splat';

        // Wait for the mesh to load (SparkJS loads asynchronously)
        // Check if there's a ready promise or event
        if (splatMesh.ready) {
          splatMesh.ready.then(() => {
            clearTimeout(timeoutId);
            this.normalizeAndResolve(group, url, settingsUrl, resolve, reject);
          }).catch((err: any) => {
            clearTimeout(timeoutId);
            logger.error(`[GaussianSplatLoader] ❌ Load error: ${url}`, err);
            reject(new AssetLoadError('Gaussian Splat load error', url, err));
          });
        } else {
          // If no ready promise, assume synchronous load and proceed
          // Add a small delay to allow async loading to start
          setTimeout(() => {
            clearTimeout(timeoutId);
            this.normalizeAndResolve(group, url, settingsUrl, resolve, reject);
          }, 100);
        }
      } catch (e) {
        clearTimeout(timeoutId);
        logger.error(`[GaussianSplatLoader] ❌ Failed to create splat mesh: ${url}`, e);
        reject(new AssetLoadError('Failed to initialize Gaussian Splat mesh', url, e));
      }
    });
  }

  private normalizeAndResolve(
    group: THREE.Group,
    url: string,
    settingsUrl: string | undefined,
    resolve: (asset: GaussianSplatAsset) => void,
    reject: (error: Error) => void
  ) {
    try {
      // Normalize scale and position (similar to GLTFModelLoader)
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      logger.verbose(`[GaussianSplatLoader] Original size: ${maxDim.toFixed(3)}m`);

      if (maxDim > 0) {
        const scale = 1.0 / maxDim; // Normalize to 1 unit
        group.scale.multiplyScalar(scale);
        logger.verbose(`[GaussianSplatLoader] Normalized scale: ${scale.toFixed(3)}x`);
      }

      // Center model
      const center = box.getCenter(new THREE.Vector3());
      group.position.sub(center);
      logger.verbose(`[GaussianSplatLoader] Centered at: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
      
      // Log bounds for debugging
      logger.verbose(`[GaussianSplatLoader] Loaded splat bounds:`, {
        size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
        center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) },
        maxDim: maxDim.toFixed(2)
      });

      const asset: GaussianSplatAsset = {
        scene: group,
        url,
        settingsUrl,
      };

      logger.verbose(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
      resolve(asset);
    } catch (e) {
      logger.error(`[GaussianSplatLoader] ❌ Failed to process splat: ${url}`, e);
      reject(new AssetLoadError('Failed to process Gaussian Splat', url, e));
    }
  }

  /**
   * Clone a Gaussian Splat asset for multiple instances.
   * Similar to GLTFModelLoader.cloneAsset()
   */
  private cloneAsset(asset: GaussianSplatAsset): GaussianSplatAsset {
    const scene = asset.scene.clone(true);
    
    // Deep clone materials and geometries
    scene.traverse((child: any) => {
      if (child.isMesh || child.isPoints || child.type === 'SplatMesh') {
        // For SparkJS SplatMesh, cloning may need special handling
        // If the library doesn't support cloning, we may need to create a new instance
        // For now, try standard Three.js clone
        if (child.material) {
          child.material = child.material.clone();
        }
        if (child.geometry) {
          child.geometry = child.geometry.clone();
        }
      }
    });

    return {
      scene,
      url: asset.url,
      settingsUrl: asset.settingsUrl,
    };
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
    logger.verbose('[GaussianSplatLoader] Disposed and cleared cache.');
  }
}
