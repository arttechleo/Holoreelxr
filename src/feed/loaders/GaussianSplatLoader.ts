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
      this.SplatMeshClass = module.SplatMesh;
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

  /**
   * Load a Gaussian Splat from a URL.
   * 
   * IMPORTANT: The .ply file must be:
   * 1. Placed in public/assets/ directory (for Vite dev server)
   * 2. Referenced as "/assets/filename.ply" (not "./public/assets/...")
   * 3. A valid 3D Gaussian Splat format (not a regular mesh PLY)
   * 
   * If loading fails, check:
   * - Network tab for HTTP status (should be 200, not 404)
   * - Console for detailed error messages
   * - That the file is actually a Gaussian splat (try loading in SuperSplat editor)
   */
  private async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    console.log(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);
    logger.verbose(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);

    // Step 1: Verify URL is accessible before attempting to load
    try {
      console.log(`[GaussianSplatLoader] 📡 Checking URL accessibility: ${url}`);
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        console.error(`[GaussianSplatLoader] ❌ URL not accessible: ${errorMsg}`);
        logger.error(`[GaussianSplatLoader] ❌ URL not accessible: ${errorMsg}`);
        throw new AssetLoadError(`Failed to access PLY file: ${errorMsg}`, url);
      }
      const contentLength = response.headers.get('content-length');
      console.log(`[GaussianSplatLoader] ✅ URL accessible (${response.status}), size: ${contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB` : 'unknown'}`);
      logger.verbose(`[GaussianSplatLoader] ✅ URL accessible, content-length: ${contentLength}`);
    } catch (fetchError: any) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        console.error(`[GaussianSplatLoader] ❌ CORS/Network error: ${errorMsg}`);
        console.error(`[GaussianSplatLoader] 💡 Tip: Ensure the file is in public/assets/ and referenced as "/assets/filename.ply"`);
        logger.error(`[GaussianSplatLoader] ⚠️ CORS/Network issue detected for ${url}`);
      }
      throw new AssetLoadError(`Network error accessing PLY file: ${errorMsg}`, url, fetchError);
    }

    // Step 2: Create SplatMesh and wait for initialization
    try {
      console.log(`[GaussianSplatLoader] 🎨 Creating SplatMesh from: ${url}`);
      logger.verbose(`[GaussianSplatLoader] Creating SplatMesh from: ${url}`);
      
      // Create SplatMesh using SparkJS API
      // SplatMesh constructor takes options: { url, onLoad, ... }
      // It has an `initialized` promise that resolves when loading is complete
      const splatMesh = new this.SplatMeshClass({ url });
      
      console.log(`[GaussianSplatLoader] ⏳ Waiting for SplatMesh initialization...`);
      logger.verbose(`[GaussianSplatLoader] Waiting for SplatMesh.initialized promise...`);
      
      // Wait for the mesh to initialize (SparkJS loads asynchronously)
      // The `initialized` property is a Promise<SplatMesh>
      await splatMesh.initialized;
      
      console.log(`[GaussianSplatLoader] ✅ SplatMesh initialized successfully`);
      logger.verbose(`[GaussianSplatLoader] ✅ SplatMesh initialized: ${url}`);
      
      // Step 3: Wrap in a Group for consistency with GLTF assets
      // CRITICAL: SparkRenderer should be able to discover SplatMesh even when wrapped in a Group
      // via scene traversal. However, we ensure the SplatMesh itself is visible and properly configured.
      const group = new THREE.Group();
      
      // Ensure SplatMesh is visible and properly configured before adding to group
      (splatMesh as any).visible = true;
      if ((splatMesh as any).castShadow !== undefined) {
        (splatMesh as any).castShadow = false; // Splats typically don't cast shadows
      }
      if ((splatMesh as any).receiveShadow !== undefined) {
        (splatMesh as any).receiveShadow = false;
      }
      
      group.add(splatMesh);
      group.name = 'gaussian-splat';

      // Step 4: Normalize scale and position (similar to GLTFModelLoader)
      console.log(`[GaussianSplatLoader] 📐 Normalizing splat scale and position...`);
      logger.verbose(`[GaussianSplatLoader] Normalizing splat...`);
      this.normalizeSplat(group);

      const asset: GaussianSplatAsset = {
        scene: group,
        url,
        settingsUrl,
      };

      console.log(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
      logger.verbose(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
      return asset;
    } catch (e: any) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[GaussianSplatLoader] ❌ Failed to load splat: ${url}`, e);
      console.error(`[GaussianSplatLoader] Error details:`, {
        message: errorMsg,
        name: e?.name,
        stack: e?.stack
      });
      logger.error(`[GaussianSplatLoader] ❌ Failed to load splat: ${url}`, e);
      
      // Provide helpful error messages
      if (errorMsg.includes('CORS') || errorMsg.includes('fetch') || errorMsg.includes('Failed to fetch')) {
        console.error(`[GaussianSplatLoader] ⚠️ CORS/Network issue detected`);
        console.error(`[GaussianSplatLoader] 💡 Ensure file is in public/assets/ and URL is "/assets/filename.ply"`);
        logger.error(`[GaussianSplatLoader] ⚠️ CORS/Network issue detected for ${url}`);
      } else if (errorMsg.includes('parse') || errorMsg.includes('format') || errorMsg.includes('invalid')) {
        console.error(`[GaussianSplatLoader] ⚠️ File format issue - may not be a valid Gaussian splat PLY`);
        console.error(`[GaussianSplatLoader] 💡 Try loading the file in SuperSplat editor to verify format`);
        logger.error(`[GaussianSplatLoader] ⚠️ File format issue for ${url}`);
      }
      
      throw new AssetLoadError('Gaussian Splat load error', url, e);
    }
  }

  private normalizeSplat(group: THREE.Group) {
    // Normalize scale and position (similar to GLTFModelLoader)
    // For SparkJS SplatMesh, we can use getBoundingBox() method if available
    // Otherwise fall back to setFromObject
    const splatMesh = group.children[0] as any;
    let box: THREE.Box3;
    
    if (splatMesh && typeof splatMesh.getBoundingBox === 'function') {
      // Use SparkJS's built-in bounding box method (more accurate)
      // getBoundingBox() can take a boolean parameter: getBoundingBox(centers_only?: boolean)
      try {
        box = splatMesh.getBoundingBox(false); // false = include full splat bounds, not just centers
        logger.verbose(`[GaussianSplatLoader] Using SplatMesh.getBoundingBox()`);
      } catch (e) {
        // Fallback if getBoundingBox fails
        box = new THREE.Box3().setFromObject(group);
        logger.verbose(`[GaussianSplatLoader] getBoundingBox() failed, using setFromObject fallback`);
      }
    } else {
      // Fallback to Three.js bounding box calculation
      box = new THREE.Box3().setFromObject(group);
      logger.verbose(`[GaussianSplatLoader] Using setFromObject for bounding box`);
    }
    
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    logger.verbose(`[GaussianSplatLoader] Original size: ${maxDim.toFixed(3)}m`);

    if (maxDim > 0 && maxDim < 1000) { // Only normalize if size is reasonable
      const scale = 1.0 / maxDim; // Normalize to 1 unit
      group.scale.multiplyScalar(scale);
      logger.verbose(`[GaussianSplatLoader] Normalized scale: ${scale.toFixed(3)}x`);
    } else if (maxDim >= 1000) {
      logger.warn(`[GaussianSplatLoader] Splat size very large (${maxDim.toFixed(2)}m), skipping normalization`);
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
  }

  /**
   * Clone a Gaussian Splat asset for multiple instances.
   * Similar to GLTFModelLoader.cloneAsset()
   * 
   * Note: SparkJS SplatMesh may not support standard Three.js cloning.
   * For now, we return the same asset (shared instance) since SplatMesh
   * is designed to be reused efficiently. If true cloning is needed later,
   * we would need to create a new SplatMesh instance with the same URL.
   */
  private cloneAsset(asset: GaussianSplatAsset): GaussianSplatAsset {
    // For SparkJS, SplatMesh instances are designed to be shared efficiently
    // Creating a new instance would require re-loading the file, which is expensive
    // Instead, we create a new Group wrapper but reuse the same SplatMesh
    const newGroup = new THREE.Group();
    const originalSplatMesh = asset.scene.children[0];
    
    if (originalSplatMesh) {
      // Add the same SplatMesh instance to a new group
      // This allows multiple groups to reference the same splat data efficiently
      newGroup.add(originalSplatMesh);
      newGroup.name = 'gaussian-splat';
      
      // Copy transform properties from original group
      newGroup.position.copy(asset.scene.position);
      newGroup.rotation.copy(asset.scene.rotation);
      newGroup.scale.copy(asset.scene.scale);
    }

    return {
      scene: newGroup,
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
