// src/feed/loaders/GLTFLoader.ts
import * as THREE from 'three';
import { retry, logError, AssetLoadError } from '../../utils/errors';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type GLTFAsset = {
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
      cached = retry(() => this.loadGLTF(url), {
        maxAttempts: 3,
        delayMs: 500,
        onRetry: (attempt, error) => {
          console.warn(`Retry ${attempt}/3 loading ${url}:`, error);
        },
      }).then((asset) => {
        // Store original, return as-is for cloning later
        return asset;
      });

      this.cache.set(url, cached);
    }

    return cached;
  }

  private loadGLTF(url: string): Promise<GLTFAsset> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new AssetLoadError(`Load timeout after 30s`, url));
      }, 30000);

      this.loader.load(
        url,
        (gltf: GLTFAsset) => {
          clearTimeout(timeoutId);
          try {
            if (!gltf || !gltf.scene) {
              throw new AssetLoadError('Invalid GLTF - missing scene', url);
            }

            // Normalize model scale and position
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            if (maxDim > 0) {
              const scale = 1.0 / maxDim; // Normalize to 1 unit
              gltf.scene.scale.multiplyScalar(scale);
            }

            // Center model
            const center = box.getCenter(new THREE.Vector3());
            gltf.scene.position.sub(center);

            resolve(gltf);
          } catch (e) {
            reject(new AssetLoadError('Failed to process GLTF', url, e));
          }
        },
        undefined,
        (err: unknown) => {
          clearTimeout(timeoutId);
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

