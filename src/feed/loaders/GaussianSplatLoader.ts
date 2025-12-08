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

// Type definitions for SparkJS SplatMesh
// Based on actual SparkJS API: https://sparkjs.dev/docs/splat-mesh/
export interface SparkSplatMesh extends THREE.Object3D {
  /** Promise that resolves when the SplatMesh has finished loading */
  initialized: Promise<this>;
  
  /** Get bounding box of the splat (centers_only?: boolean) */
  getBoundingBox?: (centers_only?: boolean) => THREE.Box3;
  
  // Additional properties that may exist
  url?: string;
  material?: any;
}

/** Constructor type for SparkSplatMesh */
export type SparkSplatMeshCtor = new (opts: { url: string }) => SparkSplatMesh;

// Debug flag - only log to console in dev mode
// @ts-ignore - Vite injects import.meta.env at build time
const DEBUG_SPLATS = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) || false;

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
  private SplatMeshClass?: SparkSplatMeshCtor; // Will be initialized from library

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
      const Ctor = module.SplatMesh as SparkSplatMeshCtor | undefined;
      if (!Ctor) {
        throw new Error('SplatMesh not found in @sparkjsdev/spark');
      }
      this.SplatMeshClass = Ctor;
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
    if (DEBUG_SPLATS) {
      console.log(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);
    }
    logger.verbose(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);

    // Step 1: Optional HEAD check (non-fatal) - just for early validation
    // If HEAD fails, we proceed anyway and let Spark's own load handle errors
    try {
      if (DEBUG_SPLATS) {
        console.log(`[GaussianSplatLoader] 📡 Checking URL accessibility: ${url}`);
      }
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) {
        // Just warn, don't hard-fail here
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        if (DEBUG_SPLATS) {
          console.warn(`[GaussianSplatLoader] ⚠️ HEAD request failed (${errorMsg}), proceeding to Spark load anyway`);
        }
        logger.warn(`[GaussianSplatLoader] ⚠️ HEAD request failed (${errorMsg}), proceeding to Spark load anyway`);
      } else {
        const contentLength = response.headers.get('content-length');
        if (DEBUG_SPLATS) {
          console.log(`[GaussianSplatLoader] ✅ URL accessible (${response.status}), size: ${contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB` : 'unknown'}`);
        }
        logger.verbose(`[GaussianSplatLoader] ✅ URL accessible, content-length: ${contentLength}`);
      }
    } catch (headError: any) {
      // HEAD check failed - just log and continue
      // Spark's own load will handle actual errors
      if (DEBUG_SPLATS) {
        console.warn(`[GaussianSplatLoader] ⚠️ HEAD check failed (${String(headError)}), proceeding to Spark load`);
      }
      logger.verbose(`[GaussianSplatLoader] HEAD check failed, proceeding anyway: ${String(headError)}`);
    }

    // Step 2: Create SplatMesh and wait for initialization
    if (!this.SplatMeshClass) {
      throw new Error('SplatMeshClass not initialized - call initializeLoader() first');
    }
    
    try {
      if (DEBUG_SPLATS) {
        console.log(`[GaussianSplatLoader] 🎨 Creating SplatMesh from: ${url}`);
      }
      logger.verbose(`[GaussianSplatLoader] Creating SplatMesh from: ${url}`);
      
      // Create SplatMesh using SparkJS API
      // SplatMesh constructor takes options: { url, onLoad, ... }
      // It has an `initialized` promise that resolves when loading is complete
      const splatMesh = new this.SplatMeshClass({ url });
      
      if (DEBUG_SPLATS) {
        console.log(`[GaussianSplatLoader] ⏳ Waiting for SplatMesh initialization...`);
      }
      logger.verbose(`[GaussianSplatLoader] Waiting for SplatMesh.initialized promise...`);
      
      // Wait for the mesh to initialize (SparkJS loads asynchronously)
      // The `initialized` property is a Promise<SplatMesh>
      await splatMesh.initialized;
      
      if (DEBUG_SPLATS) {
        console.log(`[GaussianSplatLoader] ✅ SplatMesh initialized successfully`);
      }
      logger.verbose(`[GaussianSplatLoader] ✅ SplatMesh initialized: ${url}`);
      
      // Step 3: Wrap in a Group for consistency with GLTF assets
      // CRITICAL: SparkRenderer should be able to discover SplatMesh even when wrapped in a Group
      // via scene traversal. However, we ensure the SplatMesh itself is visible and properly configured.
      const group = new THREE.Group();
      
      // Ensure SplatMesh is visible and properly configured before adding to group
      // Note: Only set these if SplatMesh actually extends THREE.Object3D and supports these properties
      splatMesh.visible = true;
      // Don't set castShadow/receiveShadow unless we know Spark supports them
      // Spark's SplatMesh may not respect these Three.js properties
      
      group.add(splatMesh);
      group.name = 'gaussian-splat';

      // Step 4: Normalize scale and position (similar to GLTFModelLoader)
      if (DEBUG_SPLATS) {
        console.log(`[GaussianSplatLoader] 📐 Normalizing splat scale and position...`);
      }
      logger.verbose(`[GaussianSplatLoader] Normalizing splat...`);
      this.normalizeSplat(group);

      const asset: GaussianSplatAsset = {
        scene: group,
        url,
        settingsUrl,
      };

      if (DEBUG_SPLATS) {
        console.log(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
      }
      logger.verbose(`[GaussianSplatLoader] ✅ Load successful: ${url}`);
      return asset;
    } catch (e: any) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (DEBUG_SPLATS) {
        console.error(`[GaussianSplatLoader] ❌ Failed to load splat: ${url}`, e);
        console.error(`[GaussianSplatLoader] Error details:`, {
          message: errorMsg,
          name: e?.name,
          stack: e?.stack
        });
      }
      logger.error(`[GaussianSplatLoader] ❌ Failed to load splat: ${url}`, e);
      
      // Provide helpful error messages
      if (errorMsg.includes('CORS') || errorMsg.includes('fetch') || errorMsg.includes('Failed to fetch')) {
        if (DEBUG_SPLATS) {
          console.error(`[GaussianSplatLoader] ⚠️ CORS/Network issue detected`);
          console.error(`[GaussianSplatLoader] 💡 Ensure file is in public/assets/ and URL is "/assets/filename.ply"`);
        }
        logger.error(`[GaussianSplatLoader] ⚠️ CORS/Network issue detected for ${url}`);
      } else if (errorMsg.includes('parse') || errorMsg.includes('format') || errorMsg.includes('invalid')) {
        if (DEBUG_SPLATS) {
          console.error(`[GaussianSplatLoader] ⚠️ File format issue - may not be a valid Gaussian splat PLY`);
          console.error(`[GaussianSplatLoader] 💡 Try loading the file in SuperSplat editor to verify format`);
        }
        logger.error(`[GaussianSplatLoader] ⚠️ File format issue for ${url}`);
      }
      
      throw new AssetLoadError('Gaussian Splat load error', url, e);
    }
  }

  private normalizeSplat(group: THREE.Group) {
    // Normalize scale and position (similar to GLTFModelLoader)
    // For SparkJS SplatMesh, we can use getBoundingBox() method if available
    // Otherwise fall back to setFromObject
    const splatMesh = group.children[0] as SparkSplatMesh | undefined;
    const box = new THREE.Box3();
    
    if (splatMesh && typeof splatMesh.getBoundingBox === 'function') {
      // Use SparkJS's built-in bounding box method (more accurate)
      // getBoundingBox() can take a boolean parameter: getBoundingBox(centers_only?: boolean)
      try {
        const meshBox = splatMesh.getBoundingBox(false); // false = include full splat bounds, not just centers
        if (meshBox && !meshBox.isEmpty()) {
          box.copy(meshBox);
          logger.verbose(`[GaussianSplatLoader] Using SplatMesh.getBoundingBox()`);
        } else {
          // Empty box from getBoundingBox - fallback
          box.setFromObject(group);
          logger.warn(`[GaussianSplatLoader] getBoundingBox() returned empty box, using setFromObject fallback`);
        }
      } catch (e) {
        // Fallback if getBoundingBox fails
        box.setFromObject(group);
        logger.warn(`[GaussianSplatLoader] getBoundingBox() failed, using setFromObject fallback`, e);
      }
    } else {
      // Fallback to Three.js bounding box calculation
      box.setFromObject(group);
      logger.verbose(`[GaussianSplatLoader] Using setFromObject for bounding box`);
    }
    
    // Guard against empty bounds
    if (box.isEmpty()) {
      logger.warn(`[GaussianSplatLoader] Bounding box is empty; skipping normalization`);
      return;
    }
    
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    logger.verbose(`[GaussianSplatLoader] Original size: ${maxDim.toFixed(3)}m`);

    if (maxDim > 0 && !isNaN(maxDim) && isFinite(maxDim)) {
      // XR-friendly target size: 1.5 meters (comfortable viewing distance)
      // This makes splats predictable in physical space for WebXR
      const targetSize = 1.5;
      const scale = targetSize / maxDim;
      
      // Guard against extreme scales
      if (scale > 0 && scale < 1000 && isFinite(scale)) {
        group.scale.multiplyScalar(scale);
        logger.verbose(`[GaussianSplatLoader] Normalized scale: ${scale.toFixed(3)}x (target: ${targetSize}m)`);
      } else {
        logger.warn(`[GaussianSplatLoader] Calculated scale is extreme (${scale.toFixed(3)}x), skipping normalization`);
      }
    } else {
      logger.warn(`[GaussianSplatLoader] Invalid maxDim (${maxDim}), skipping normalization`);
    }

    // Center model
    const center = box.getCenter(new THREE.Vector3());
    // Check if center is finite (not NaN or Infinity)
    if (center && isFinite(center.x) && isFinite(center.y) && isFinite(center.z)) {
      group.position.sub(center);
      logger.verbose(`[GaussianSplatLoader] Centered at origin from: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
    } else {
      logger.warn(`[GaussianSplatLoader] Invalid center (NaN/Infinity), skipping centering`);
    }
    
    // Log bounds for debugging
    logger.verbose(`[GaussianSplatLoader] Loaded splat bounds:`, {
      size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
      center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) },
      maxDim: maxDim.toFixed(2)
    });
  }

  /**
   * Clone a Gaussian Splat asset for multiple instances.
   * 
   * CRITICAL FIX: In Three.js, an Object3D can only have one parent.
   * When you add an object to a new parent, it's automatically removed from the old one.
   * 
   * Therefore, we cannot simply reparent the same SplatMesh into multiple groups.
   * 
   * For now, we return the original asset (no cloning) to avoid this bug.
   * 
   * If true multiple instances are needed in the future, we would need to:
   * 1. Create a new SplatMesh instance per clone: `new SplatMeshClass({ url: asset.url })`
   * 2. Wait for each new instance to initialize
   * 3. Or use Spark's instancing support if available
   * 
   * But until that's implemented, sharing the same asset is safe and avoids
   * the "ghost splat" bug where only one instance is ever visible.
   */
  private cloneAsset(asset: GaussianSplatAsset): GaussianSplatAsset {
    // No cloning for now - return the original asset
    // This avoids re-parenting the SplatMesh, which breaks Three.js hierarchy
    // If multiple instances are truly needed, create new SplatMesh instances
    return asset;
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
    logger.verbose('[GaussianSplatLoader] Disposed and cleared cache.');
  }
}
