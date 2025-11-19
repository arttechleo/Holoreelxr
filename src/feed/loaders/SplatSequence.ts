// src/feed/loaders/SplatSequence.ts
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { retry, logError, AssetLoadError } from '../../utils/errors';

export class SplatSequence {
  public ready: Promise<void>;

  private parent: THREE.Object3D;
  private root: THREE.Group;

  private framesUrls: string[];
  private fps: number;

  private frames: THREE.Object3D[] = [];
  private curIndex = 0;
  private playing = false;
  private acc = 0;

  private loader = new PLYLoader();
  private disposed = false;

  constructor(parent: THREE.Object3D, framesUrls: string[], fps: number) {
    this.parent = parent;
    this.framesUrls = framesUrls;
    this.fps = Math.max(0, fps | 0);

    this.root = new THREE.Group();
    this.root.name = 'splat-sequence-root';
    this.parent.add(this.root);

    // begin loading
    this.ready = this.loadAll().then(() => {
      // show first frame
      if (this.frames.length) {
        this.frames.forEach((f, i) => (f.visible = i === 0));
        this.curIndex = 0;
      }
      // start playback if >1 frame and fps > 0
      this.playing = this.frames.length > 1 && this.fps > 0;
      // attach an internal update loop
      this.loop();
    });
  }

  // --------- Public API ----------

  /** Set uniform scale and Y rotation for the whole sequence root */
  setTransform(scale: number, rotY: number) {
    if (this.disposed) return;
    // No scale limits - allow unlimited scaling
    const s = Math.max(0.001, scale); // Only prevent negative/zero scale
    this.root.scale.setScalar(s);
    this.root.rotation.y = rotY;
  }

  /** Set world-space position for the whole sequence root */
  setPosition(pos: THREE.Vector3) {
    if (this.disposed) return;
    this.root.position.copy(pos);
  }

  /** Optional manual control of current frame (0..n-1) */
  setFrameIndex(i: number) {
    if (this.disposed || !this.frames.length) return;
    const idx = ((i % this.frames.length) + this.frames.length) % this.frames.length;
    if (idx === this.curIndex) return;
    this.frames[this.curIndex].visible = false;
    this.frames[idx].visible = true;
    this.curIndex = idx;
  }

  /** Start/stop internal playback (if multi-frame and fps>0) */
  setPlaying(on: boolean) {
    this.playing = !!on && this.frames.length > 1 && this.fps > 0;
  }

  /** Clean up GPU/CPU resources */
  dispose() {
    this.disposed = true;
    this.parent.remove(this.root);
    for (const obj of this.frames) {
      obj.traverse((n: any) => {
        n.geometry?.dispose?.();
        n.material?.dispose?.();
      });
    }
    this.frames.length = 0;
  }

  // --------- Internals ----------

  private async loadAll() {
    // Load serially to keep memory sane (change to Promise.all if you prefer)
    for (const url of this.framesUrls) {
      if (this.disposed) break;
      try {
        const obj = await retry(
          () => this.loadPLYAsPoints(url),
          {
            maxAttempts: 3,
            delayMs: 500,
            onRetry: (attempt, error) => {
              console.warn(`Retry ${attempt}/3 loading ${url}:`, error);
            }
          }
        );
        obj.visible = false;
        this.root.add(obj);
        this.frames.push(obj);
      } catch (error) {
        logError(error, `SplatSequence.loadAll: ${url}`);
        // Continue loading other frames even if one fails
        console.warn(`Skipping failed frame: ${url}`);
      }
    }

    if (this.frames.length === 0) {
      throw new AssetLoadError('Failed to load any frames', this.framesUrls[0] || 'unknown');
    }
  }

  private loadPLYAsPoints(url: string): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new AssetLoadError(`Load timeout after 30s`, url));
      }, 30000);

      this.loader.load(
        url,
        (geom) => {
          clearTimeout(timeoutId);
          try {
            // Validate geometry
            if (!geom || !geom.getAttribute('position')) {
              throw new AssetLoadError('Invalid PLY geometry - missing position attribute', url);
            }

            const posCount = geom.getAttribute('position').count;
            if (posCount === 0) {
              throw new AssetLoadError('Empty PLY geometry', url);
            }

            // Normalize geometry if needed
            if (!geom.hasAttribute('color')) {
              const colors = new Float32Array(posCount * 3);
              for (let i = 0; i < posCount; i++) {
                colors[i * 3 + 0] = 0.9;
                colors[i * 3 + 1] = 0.9;
                colors[i * 3 + 2] = 0.9;
              }
              geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            }

            const mat = new THREE.PointsMaterial({
              size: 0.01,            // tune point size for your data
              vertexColors: true,
              sizeAttenuation: true,
              transparent: true,
              opacity: 1.0,
            });

            const pts = new THREE.Points(geom, mat);
            pts.name = 'splat-seq-frame';
            resolve(pts);
          } catch (e) {
            reject(new AssetLoadError('Failed to create point cloud', url, e));
          }
        },
        undefined,
        (err) => {
          clearTimeout(timeoutId);
          reject(new AssetLoadError('PLY load error', url, err));
        }
      );
    });
  }

  private loop = () => {
    if (this.disposed) return;
    // advance animation
    if (this.playing && this.fps > 0 && this.frames.length > 1) {
      const now = performance.now();
      // use a static lastTime stored on the function to avoid extra fields
      const lastTime = (this.loop as any)._lastTime ?? now;
      const dt = (now - lastTime) / 1000;
      (this.loop as any)._lastTime = now;

      this.acc += dt;
      const step = 1 / this.fps;
      while (this.acc >= step) {
        this.acc -= step;
        this.setFrameIndex(this.curIndex + 1);
      }
    } else {
      // keep lastTime in sync even when not playing
      (this.loop as any)._lastTime = performance.now();
    }

    // keep point sprites facing camera if needed (not strictly necessary for points)
    // If you later use oriented splats, update them here against the camera.

    requestAnimationFrame(this.loop);
  };
}
