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
 * - Supports .ply (uncompressed) and .spz/.splat/.ksplat (compressed) formats
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

// Supported file extensions for Gaussian splats (uncompressed + compressed)
const SUPPORTED_SPLAT_EXTENSIONS = ['.ply', '.spz'];

function hasSupportedSplatExtension(url: string): boolean {
  const lower = url.toLowerCase();
  return SUPPORTED_SPLAT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Path to the splat manifest generated at build/dev time
const SPLAT_MANIFEST_URL = '/assets/splats-manifest.json';

type SplatManifest = {
  splats: string[];
};

/**
 * Gaussian Splat asset representation.
 * Returns a Three.js object that can be added directly to the scene.
 */
export type GaussianSplatAsset = {
  // Three.js object that can be added to scene (similar to GLTFAsset.scene)
  scene: THREE.Group;
  // URL of the loaded splat file (.ply / .spz)
  url: string;
  // Optional settings URL (for future use)
  settingsUrl?: string;
};

/**
 * Loader for Gaussian Splat content using @sparkjsdev/spark.
 * 
 * Architecture:
 * - Loads .ply (uncompressed) or .spz (compressed) splats directly into Three.js
 * - No iframes - integrates directly with our WebXR/Three.js pipeline
 * - Caching and normalization similar to GLTFModelLoader
 * - Returns shared instances (no re-parenting bugs)
 * 
 * Supported formats:
 * - .ply  – uncompressed Gaussian splat
 * - .spz  – compressed Spark splat (recommended for performance, especially on Quest 3)
 * 
 * Auto-discovery:
 * - Use load('auto') or loadFirstFromManifest() to load the first .spz from the manifest
 * - Manifest is generated at build/dev time by running `npm run generate:splats`
 * - The manifest lists all .spz files found in public/assets/
 * - Cannot discover files dynamically in the browser (must use manifest)
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
   * Load a Gaussian Splat asset from a URL (.ply or .spz).
   * 
   * Special mode: If url is "auto", loads the first splat from the manifest.
   * This is useful for quickly testing whatever .spz files are present
   * without hardcoding a specific URL.
   * 
   * Smart URL resolution:
   * - If url ends with .ply, checks for .spz version via HEAD request (non-destructive)
   * - This allows feed.json to use .ply URLs but automatically prefer .spz for performance
   * - Falls back to original .ply if .spz doesn't exist (safe, non-breaking)
   * 
   * Returns a scene that can be safely added to the world.
   */
  async load(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    await this.initializeLoader();

    // Special dev/testing mode: "auto" means "pick first from manifest"
    if (url === 'auto') {
      return this.loadFirstFromManifest(settingsUrl);
    }

    // Smart URL resolution: prefer .spz over .ply if available (non-destructive)
    const resolvedUrl = await this.preferSpzVariant(url);
    if (resolvedUrl !== url) {
      logger.verbose(`[GaussianSplatLoader] 🔁 Using .spz variant: ${resolvedUrl} (preferred over ${url})`);
    }

    const base = await this.fetchOrCache(resolvedUrl, settingsUrl);
    return this.cloneAsset(base);
  }
  
  /**
   * Prefer .spz variant over .ply if it exists (non-destructive fallback).
   * Uses HEAD request to check if .spz exists without breaking .ply support.
   * 
   * @param url Original URL (may be .ply or .spz)
   * @returns Resolved URL (prefers .spz if available, otherwise returns original)
   */
  private async preferSpzVariant(url: string): Promise<string> {
    const lower = url.toLowerCase();
    if (!lower.endsWith('.ply')) {
      return url; // Not a .ply URL, return as-is
    }
    
    const spzUrl = url.replace(/\.ply$/i, '.spz');
    
    try {
      const res = await fetch(spzUrl, { method: 'HEAD' });
      if (res.ok) {
        logger.verbose(`[GaussianSplatLoader] 🔁 Using .spz variant: ${spzUrl}`);
        return spzUrl;
      }
    } catch (e) {
      logger.verbose(`[GaussianSplatLoader] .spz check failed for ${url}, using .ply`, e);
    }
    
    // Fallback: keep original .ply
    return url;
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
   * Supported formats (via SparkJS SplatMesh):
   * - .ply  – uncompressed Gaussian splat
   * - .spz  – compressed Spark splat (recommended for mobile / Quest 3)
   * 
   * IMPORTANT:
   * 1. Place the file under public/assets/ (for Vite dev server)
   * 2. Reference it as "/assets/filename.ply" or "/assets/filename.spz"
   * 3. Ensure it is a *Gaussian splat* export, not a generic mesh PLY
   */
  private async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    if (DEBUG_SPLATS) {
      console.log(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);
    }
    logger.verbose(`[GaussianSplatLoader] 🔄 Starting load: ${url}`);

    // Simple extension hint to catch obvious mistakes early
    if (!hasSupportedSplatExtension(url)) {
      logger.warn(
        `[GaussianSplatLoader] URL does not have a known splat extension (.ply/.spz): ${url}`
      );
      if (DEBUG_SPLATS) {
        console.warn(
          `[GaussianSplatLoader] ⚠️ URL does not end with .ply or .spz – is this a valid splat asset?`
        );
      }
    }

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
      
      // ✅ ORIENTATION FIX – 180° rotation around X axis
      // Spark samples use quaternion (1,0,0,0) for correct upright splats.
      // NOTE: Identity quaternion is (0,0,0,1); (1,0,0,0) is NOT identity.
      if (splatMesh.quaternion) {
        splatMesh.quaternion.set(1, 0, 0, 0);
        logger.verbose(
          `[GaussianSplatLoader] Applied orientation fix (180° around X)`
        );
      }
      
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
      const group = new THREE.Group();

      // Ensure SplatMesh is visible and not culled accidentally
      splatMesh.visible = true;
      splatMesh.frustumCulled = false;
      group.frustumCulled = false;

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
          console.error(`[GaussianSplatLoader] 💡 Ensure file is in public/assets/ and URL is "/assets/filename.ply" or ".spz"`);
        }
        logger.error(`[GaussianSplatLoader] ⚠️ CORS/Network issue detected for ${url}`);
      } else if (errorMsg.includes('parse') || errorMsg.includes('format') || errorMsg.includes('invalid')) {
        if (DEBUG_SPLATS) {
          console.error(`[GaussianSplatLoader] ⚠️ File format issue - may not be a valid Gaussian splat`);
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
   * CRITICAL: In Three.js, an Object3D can only have one parent.
   * We do NOT reparent the same SplatMesh into multiple groups.
   * 
   * If true multiple instances are needed in the future:
   * - Create new SplatMesh instances per clone, or
   * - Use Spark's instancing support if/when available.
   */
  private cloneAsset(asset: GaussianSplatAsset): GaussianSplatAsset {
    // For now, we just share the same asset instance (no re-parenting).
    return asset;
  }

  /**
   * Load the splat manifest (if available) and return the list of URLs.
   * Used for "auto" loading of .spz files for testing/dev.
   * Also used for smart URL resolution (.ply → .spz).
   * 
   * Note: The manifest is generated at build/dev time and cannot be discovered
   * dynamically in the browser. Run `npm run generate:splats` to regenerate it.
   */
  async loadSplatManifest(): Promise<string[]> {
    try {
      const res = await fetch(SPLAT_MANIFEST_URL, { method: 'GET' });
      if (!res.ok) {
        logger.warn(
          `[GaussianSplatLoader] Splat manifest not accessible: ${SPLAT_MANIFEST_URL} (${res.status})`
        );
        return [];
      }
      const json = (await res.json()) as SplatManifest;
      if (!json || !Array.isArray(json.splats)) {
        logger.warn(
          `[GaussianSplatLoader] Splat manifest has invalid shape: ${SPLAT_MANIFEST_URL}`
        );
        return [];
      }
      return json.splats;
    } catch (err) {
      logger.warn(
        `[GaussianSplatLoader] Failed to load splat manifest: ${SPLAT_MANIFEST_URL}`,
        err
      );
      return [];
    }
  }

  /**
   * Convenience helper: load the first available splat from the manifest.
   * This is useful for quickly testing whatever .spz files are present
   * without hardcoding a specific URL.
   * 
   * The manifest is generated at build/dev time by running `npm run generate:splats`.
   * It lists all .spz files found in public/assets/.
   */
  async loadFirstFromManifest(settingsUrl?: string): Promise<GaussianSplatAsset> {
    await this.initializeLoader();
    const splats = await this.loadSplatManifest();

    if (!splats.length) {
      throw new AssetLoadError(
        'No splats found in splats-manifest.json. Add .spz files and regenerate the manifest.',
        SPLAT_MANIFEST_URL
      );
    }

    // For now: just take the first one
    const first = splats[0];
    logger.verbose(
      `[GaussianSplatLoader] Loading first splat from manifest: ${first}`
    );
    return this.load(first, settingsUrl);
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
    logger.verbose('[GaussianSplatLoader] Disposed and cleared cache.');
  }
}
