// src/feed/loaders/GLTFLoader.ts
import * as THREE from 'three';
import { retry, logError, AssetLoadError } from '../../utils/errors';

// Type declaration for GLTFLoader
declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  import * as THREE from 'three';
  export class GLTFLoader {
    load(
      url: string,
      onLoad: (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => void,
      onProgress?: (ev: ProgressEvent<EventTarget>) => void,
      onError?: (err: unknown) => void
    ): void;
  }
}

export class GLTFModelLoader {
  private loader: any;
  private disposed = false;

  constructor() {
    // Dynamically import GLTFLoader
    import('three/examples/jsm/loaders/GLTFLoader.js').then((module) => {
      this.loader = new module.GLTFLoader();
    }).catch((err) => {
      console.error('Failed to load GLTFLoader:', err);
    });
  }

  async load(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    if (!this.loader) {
      // Wait for loader to be ready
      await new Promise((resolve) => {
        const checkLoader = setInterval(() => {
          if (this.loader) {
            clearInterval(checkLoader);
            resolve(undefined);
          }
        }, 50);
        setTimeout(() => {
          clearInterval(checkLoader);
          if (!this.loader) {
            throw new AssetLoadError('GLTFLoader not available', url);
          }
        }, 5000);
      });
    }

    return retry(
      () => this.loadGLTF(url),
      {
        maxAttempts: 3,
        delayMs: 500,
        onRetry: (attempt, error) => {
          console.warn(`Retry ${attempt}/3 loading ${url}:`, error);
        }
      }
    );
  }

  private loadGLTF(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new AssetLoadError(`Load timeout after 30s`, url));
      }, 30000);

      this.loader.load(
        url,
        (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => {
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

  dispose() {
    this.disposed = true;
  }
}

