// src/feed/loaders/GLTFLoader.ts
import * as THREE from 'three';
import { retry, logError, AssetLoadError } from '../../utils/errors';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type GLTFAsset = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

export class GLTFModelLoader {
  private loader: GLTFLoader;
  private cache = new Map<string, Promise<GLTFAsset>>();
  private disposed = false;

  constructor() {
    this.loader = new GLTFLoader();
  }

  /**
   * Load a GLTF/GLB and return a deep-cloned scene so it can be safely added to
   * the world without mutating cached assets. Subsequent loads reuse the cached
   * payload and only pay the cost of cloning.
   */
  async load(url: string): Promise<GLTFAsset> {
    const base = await this.fetchOrCache(url);
    return this.cloneAsset(base);
  }

  /**
   * Preload an asset into the cache so it is instantly available when needed.
   * Safe to call multiple times – only the first call performs network I/O.
   */
  async preload(url: string): Promise<void> {
    await this.fetchOrCache(url);
  }

  private async fetchOrCache(url: string): Promise<GLTFAsset> {
    if (this.disposed) {
      throw new Error('GLTFModelLoader is disposed');
    }

    let cached = this.cache.get(url);
    if (!cached) {
      console.log(`[GLTFLoader] Starting new load (not cached): ${url}`);
      cached = retry(() => this.loadGLTF(url), {
        maxAttempts: 3,
        delayMs: 500,
        onRetry: (attempt, error) => {
          console.warn(`[GLTFLoader] Retry ${attempt}/3 loading ${url}:`, error);
        },
      }).then((asset) => {
        console.log(`[GLTFLoader] ✅ Successfully cached: ${url}`);
        // Store original, return as-is for cloning later
        return asset;
      }).catch(error => {
        console.error(`[GLTFLoader] ❌ All retry attempts failed for: ${url}`, error);
        // Remove from cache so we can try again later
        this.cache.delete(url);
        throw error;
      });

      this.cache.set(url, cached);
    } else {
      console.log(`[GLTFLoader] Using cached model: ${url}`);
    }

    return cached;
  }

  private loadGLTF(url: string): Promise<GLTFAsset> {
    console.log(`[GLTFLoader] 🔄 Starting load: ${url}`);
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.error(`[GLTFLoader] ❌ Load timeout after 30s: ${url}`);
        reject(new AssetLoadError(`Load timeout after 30s`, url));
      }, 30000);

      this.loader.load(
        url,
        (gltf: GLTFAsset) => {
          clearTimeout(timeoutId);
          console.log(`[GLTFLoader] ✅ Load successful: ${url}`);
          try {
            if (!gltf || !gltf.scene) {
              throw new AssetLoadError('Invalid GLTF - missing scene', url);
            }

            console.log(`[GLTFLoader] Model info:`, {
              scenes: gltf.scene.children?.length || 0,
              animations: gltf.animations?.length || 0
            });

            // Normalize model scale and position
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            console.log(`[GLTFLoader] Original size: ${maxDim.toFixed(3)}m`);
            
            if (maxDim > 0) {
              const scale = 1.0 / maxDim; // Normalize to 1 unit
              gltf.scene.scale.multiplyScalar(scale);
              console.log(`[GLTFLoader] Normalized scale: ${scale.toFixed(3)}x`);
            }

            // Center model
            const center = box.getCenter(new THREE.Vector3());
            gltf.scene.position.sub(center);
            console.log(`[GLTFLoader] Centered at: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);

            resolve(gltf);
          } catch (e) {
            console.error(`[GLTFLoader] ❌ Failed to process GLTF: ${url}`, e);
            reject(new AssetLoadError('Failed to process GLTF', url, e));
          }
        },
        (progress) => {
          // FIX #2: Add progress logging to track loading
          if (progress.lengthComputable) {
            const percent = (progress.loaded / progress.total * 100).toFixed(1);
            if (progress.loaded === progress.total) {
              console.log(`[GLTFLoader] ✅ Downloaded ${url}: 100%`);
            } else if (Math.random() < 0.1) { // Log 10% of progress updates to avoid spam
              console.log(`[GLTFLoader] Downloading ${url}: ${percent}%`);
            }
          }
        },
        (err: unknown) => {
          clearTimeout(timeoutId);
          console.error(`[GLTFLoader] ❌❌❌ Load error: ${url}`, err);
          
          // FIX #2: Better error diagnostics
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[GLTFLoader] Error message: ${errorMsg}`);
          
          if (errorMsg.includes('CORS') || errorMsg.includes('fetch') || errorMsg.includes('Failed to fetch')) {
            console.error(`[GLTFLoader] ⚠️ CORS/Network issue detected for ${url}`);
            console.error(`[GLTFLoader] Possible solutions:`);
            console.error(`  1. Check if the URL is accessible`);
            console.error(`  2. Verify CORS headers on the server`);
            console.error(`  3. Use a CORS proxy if needed`);
          }
          
          reject(new AssetLoadError('GLTF load error', url, err));
        }
      );
    });
  }

  private cloneAsset(asset: GLTFAsset): GLTFAsset {
    const scene = asset.scene.clone(true);
    scene.traverse((child: any) => {
      if (child.isMesh) {
        if (child.material) {
          child.material = child.material.clone();
        }
        if (child.geometry) {
          child.geometry = child.geometry.clone();
        }
      }
    });

    const animations = asset.animations?.map((clip) => clip.clone()) ?? [];
    return { scene, animations };
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
  }
}

