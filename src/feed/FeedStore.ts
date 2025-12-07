import * as THREE from 'three';
import { SplatSequence } from './loaders/SplatSequence';
import { GLTFModelLoader } from './loaders/GLTFLoader';
import { ModelAssetManager } from './loaders/ModelAssetManager';
import { GaussianSplatLoader } from './loaders/GaussianSplatLoader';
import { logError } from '../utils/errors';
import { logger } from '../config/production';

type ShapeKind = 'box' | 'sphere' | 'pyramid';

type Item =
  | { id: string; title: string; author: string; type: 'shape'; shape: ShapeKind; color?: string }
  | { id: string; title: string; author: string; type: 'splat4d'; fps: number; frames: string[] }
  | { id: string; title: string; author: string; type: 'ply'; src: string }
  | { id: string; title: string; author: string; type: 'mesh'; src: string }
  | { id: string; title: string; author: string; type: 'gltf' | 'glb'; src: string }
  | { id: string; title: string; author: string; type: 'gaussianSplat'; src: string; settingsUrl?: string };

export class FeedStore {
  items: Item[] = [];
  index = 0;

  private _scale = 1;
  private _rotY = 0;
  private targetScale = 1;
  private targetRotY = 0;
  private lastPlaced?: THREE.Vector3;

  private seq?: SplatSequence;
  private gltfLoader?: GLTFModelLoader; // Kept for backward compatibility
  private assetManager?: ModelAssetManager;
  private gaussianSplatLoader?: GaussianSplatLoader;
  private preloadInFlight = new Set<number>();
  private currentGLTF?: THREE.Group;
  private previousGLTF?: THREE.Object3D; // Keep previous model visible while loading
  private currentGaussianSplat?: { asset: import('./loaders/GaussianSplatLoader').GaussianSplatAsset; dispose: () => void };
  private onHud?: (t: string) => void;
  private parent: THREE.Object3D;
  private isLoading = false; // Track loading state to prevent concurrent loads

  private effects: {
    sprite?: THREE.Sprite;
    vel?: THREE.Vector3;
    life: number;
    tex?: THREE.Texture;
    mesh?: THREE.Mesh;
  }[] = [];

  private platform?: THREE.Mesh;
  private platformMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x000000,
    transparent: true,
    opacity: 0.0,
    roughness: 1,
    metalness: 0,
  });

  private textureLoader = new THREE.TextureLoader();
  private earthTexture?: THREE.Texture;
  private earthTextureFailed = false;
  private pyramidTexture?: THREE.Texture;
  private pyramidTextureFailed = false;

  constructor(parent: THREE.Object3D, onHud?: (text: string) => void) {
    this.parent = parent;
    this.onHud = onHud;
  }

  get scale() { return this._scale; }
  get rotationY() { return this._rotY; }
  
  // Update rotation for current model
  updateRotation(deltaY: number) {
    this._rotY += deltaY;
    this.targetRotY = this._rotY;
    this.setTransform(this._scale, this._rotY);
  }

  /** Stable key for the currently shown item (used for per-model UI state). */
  getCurrentKey(): string {
    const item = this.items[this.index];
    return item?.id ?? `item-${this.index}`;
  }

  /** Get current model's position and height for UI placement */
  getCurrentModelInfo(): { position: THREE.Vector3; height: number } | null {
    const bounds = this.getObjectBounds();
    if (!bounds) return null;
    
    const center = bounds.box.getCenter(new THREE.Vector3());
    const size = bounds.box.getSize(new THREE.Vector3());
    
    return {
      position: center,
      height: size.y,
    };
  }

  async loadFeed(url = '/feed.json') {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const text = await res.text();
      let allItems;
      try {
        allItems = JSON.parse(text);
      } catch (parseError: any) {
        logger.error(`[FeedStore.loadFeed] JSON.parse error for ${url}:`, parseError);
        logger.error(`[FeedStore.loadFeed] Error at line ${parseError.message.match(/line (\d+)/)?.[1] || 'unknown'}, column ${parseError.message.match(/column (\d+)/)?.[1] || 'unknown'}`);
        logger.error(`[FeedStore.loadFeed] First 500 chars of response:`, text.substring(0, 500));
        throw new Error(`Failed to parse feed JSON: ${parseError.message}`);
      }
      if (!Array.isArray(allItems)) {
        throw new Error('Feed JSON is not an array');
      }
      
      // FILTER: Main feed shows GLTF/GLB models and simple shapes (cube, sphere, pyramid)
      // Tutorial items (id starts with "tutorial-") are preserved for tutorial flow
      this.items = allItems.filter(item => {
        // Keep tutorial items for tutorial flow
        if (item.id && item.id.startsWith('tutorial-')) {
          return true;
        }
        // Main feed: GLTF/GLB models, Gaussian Splats, and simple shapes (exclude meshes, splat4d, ply)
        return item.type === 'gltf' || item.type === 'glb' || item.type === 'gaussianSplat' || item.type === 'shape';
      });
      
      logger.verbose(`[FeedStore] Filtered feed: ${allItems.length} total items → ${this.items.length} items (GLTF/GLB + shapes)`);
    } catch (error) {
      logError(error, 'FeedStore.loadFeed');
      logger.error(`[FeedStore.loadFeed] Failed to load feed from ${url} - using empty feed`);
      this.toast('Failed to load feed - using empty feed');
      this.items = [];
    }
  }

  // Set items directly (for asset link manager)
  setItems(items: Item[]) {
    this.items = items;
  }

  // Add item
  addItem(item: Item) {
    this.items.push(item);
  }

  async showCurrent() {
    // Prevent concurrent loads
    if (this.isLoading) {
      logger.warn('[FeedStore] Load already in progress, skipping');
      return;
    }
    
    const item = this.items[this.index];
    if (!item) {
      this.toast('No items in feed');
      this.parent.children.forEach((c) => {
        if (c.name === 'content-platform') c.visible = false;
      });
      return;
    }
    
    this.isLoading = true;
    try {

    if (this.seq) {
      this.seq.dispose();
      this.seq = undefined;
    }

    // For GLTF/GLB items: Check status before removing previous model
    let shouldKeepPreviousModel = false;
    if ((item.type === 'gltf' || item.type === 'glb')) {
      const status = this.ensureAssetManager().getStatus(item.src);
      // Keep previous model visible if new one is loading or idle (not yet ready)
      if (status.state === 'loading' || status.state === 'idle') {
        shouldKeepPreviousModel = true;
        logger.verbose(`[FeedStore] Keeping previous model visible while loading: ${item.src} (status: ${status.state})`);
      }
    }

    // Hide previous Gaussian Splat if any
    if (this.currentGaussianSplat) {
      this.currentGaussianSplat.asset.hide();
      this.currentGaussianSplat.dispose();
      this.currentGaussianSplat = undefined;
    }

    // CRITICAL: Remove ALL prior content meshes to prevent overlap
    // BUT: For GLTF items, we may keep the previous GLTF model visible while loading
    // Use slice() to avoid modifying array while iterating
    const childrenToRemove = this.parent.children.slice().filter(child => {
      // If we're keeping previous model and this is a GLTF, skip it
      if (shouldKeepPreviousModel && child.name === 'content-gltf' && child === this.currentGLTF) {
        this.previousGLTF = child; // Store as previous
        return false; // Don't remove it yet
      }
      return child.name === 'content-shape' || 
             child.name === 'content-mesh' || 
             child.name === 'content-gltf' || 
             child.name === 'content-error';
    });
    
    logger.verbose(`[FeedStore] Removing ${childrenToRemove.length} previous content objects${shouldKeepPreviousModel ? ' (keeping previous GLTF visible)' : ''}`);
    
    childrenToRemove.forEach((child) => {
      // Stop and dispose animation mixer if present
      if ((child as any).mixer) {
        (child as any).mixer.stopAllAction();
        (child as any).mixer = null;
      }
      
      // RECURSIVE disposal for GLTF models with children
      child.traverse((node: THREE.Object3D) => {
        // Dispose geometry
        if ((node as any).geometry) {
          (node as any).geometry.dispose();
        }
        
        // Dispose material(s)
        const mat = (node as any).material;
        if (mat) {
          if (Array.isArray(mat)) {
            mat.forEach(m => {
              // Dispose textures
              if (m.map) m.map.dispose();
              if (m.lightMap) m.lightMap.dispose();
              if (m.bumpMap) m.bumpMap.dispose();
              if (m.normalMap) m.normalMap.dispose();
              if (m.specularMap) m.specularMap.dispose();
              if (m.envMap) m.envMap.dispose();
              m.dispose();
            });
          } else {
            // Dispose textures
            if (mat.map) mat.map.dispose();
            if (mat.lightMap) mat.lightMap.dispose();
            if (mat.bumpMap) mat.bumpMap.dispose();
            if (mat.normalMap) mat.normalMap.dispose();
            if (mat.specularMap) mat.specularMap.dispose();
            if (mat.envMap) mat.envMap.dispose();
            mat.dispose();
          }
        }
      });
      
      // Remove from parent
      this.parent.remove(child);
      logger.verbose(`[FeedStore] ✅ Removed and disposed: ${child.name}`);
    });
    
    // CRITICAL: Clear currentGLTF reference (but keep previousGLTF if we're keeping it visible)
    if (!shouldKeepPreviousModel) {
      this.currentGLTF = undefined;
      this.previousGLTF = undefined;
    }

    // FIX #1: PRESERVE spatial placement - new models spawn where user placed the previous one
    // This is intentional behavior - user expects new models to appear at the same location
    let spawnPos: THREE.Vector3;
      if (this.lastPlaced) {
        // User has placed a model somewhere - spawn next model at that location
        spawnPos = this.lastPlaced.clone();
        logger.verbose(`[FeedStore] Using preserved placement:`, spawnPos);
      } else {
        // First model or no previous placement - use default position in front of user
        spawnPos = new THREE.Vector3(0, 1.2, -1.5); // Default position in front of user
        logger.verbose(`[FeedStore] Using default spawn position:`, spawnPos);
      }

    try {
      if (item.type === 'shape') {
        const obj = this.makeShape(item.shape, item.color, item.id);
        obj.name = 'content-shape';
        obj.position.copy(spawnPos);
        obj.rotation.y = this._rotY;
        obj.scale.setScalar(this._scale);
        this.parent.add(obj);
      } else if (item.type === 'splat4d') {
        this.seq = new SplatSequence(this.parent, item.frames, item.fps);
        await this.seq.ready;
        this.seq.setTransform(this._scale, this._rotY);
        this.seq.setPosition(spawnPos);
      } else if (item.type === 'ply') {
        this.seq = new SplatSequence(this.parent, [item.src], 0);
        await this.seq.ready;
        this.seq.setTransform(this._scale, this._rotY);
        this.seq.setPosition(spawnPos);
      } else if (item.type === 'gltf' || item.type === 'glb') {
        // NEW: Use ModelAssetManager for structured loading with status tracking
        const manager = this.ensureAssetManager();
        const status = manager.getStatus(item.src);
        
        logger.verbose(`[FeedStore] 🔄 Loading GLB/GLTF: "${item.title}" from ${item.src} (status: ${status.state})`);
        
        try {
          // If already loaded, show immediately
          // If loading/idle, wait for it (or start loading if idle)
          const gltf = await manager.loadNow(item.src);
          
          // Now remove previous model if we kept it visible
          if (this.previousGLTF) {
            logger.verbose(`[FeedStore] Removing previous model now that new one is ready`);
            this.removeModel(this.previousGLTF);
            this.previousGLTF = undefined;
          }
          
          logger.verbose(`[FeedStore] ✅ Successfully loaded GLB/GLTF: ${item.title}`);
          
          gltf.scene.name = 'content-gltf';
          
          // AUTO-SCALE: Calculate bounding box and scale to fit Mixed Reality viewport
          const autoScale = this.calculateOptimalScale(gltf.scene);
          logger.verbose(`[FeedStore] Auto-scale for ${item.title}: ${autoScale.scale.toFixed(3)}x (original size: ${autoScale.originalSize.toFixed(2)}m)`);
          
          gltf.scene.position.copy(spawnPos);
          gltf.scene.rotation.y = this._rotY;
          // CRITICAL FIX: Use ONLY autoScale, not multiplied by this._scale
          // this._scale is for user manual scaling and is reset to 1 on scroll
          // autoScale.scale is the base scale to fit viewport
          gltf.scene.scale.setScalar(autoScale.scale);
          
          // Store the base auto-scale for this model so we can apply user scaling on top
          (gltf.scene as any)._baseAutoScale = autoScale.scale;
          
          this.parent.add(gltf.scene);
          this.currentGLTF = gltf.scene;
          
          // Preloading is now handled in next() for faster response on scroll
          // Always preload here for initial loads and to ensure next items are ready
          this.preloadUpcomingModels(3);
          
          // Play animations if available
          if (gltf.animations && gltf.animations.length > 0) {
            logger.verbose(`[FeedStore] Playing ${gltf.animations.length} animation(s) for ${item.title}`);
            const mixer = new THREE.AnimationMixer(gltf.scene);
            gltf.animations.forEach((clip) => {
              mixer.clipAction(clip).play();
            });
            // Store mixer for cleanup
            (gltf.scene as any).mixer = mixer;
          }
        } catch (loadError: any) {
          logger.error(`[FeedStore] ❌ FAILED to load GLB/GLTF: ${item.title}`, loadError);
          logger.error(`[FeedStore] URL: ${item.src}`);
          
          // Check for CORS issues
          if (loadError?.message?.includes('CORS') || loadError?.message?.includes('fetch')) {
            logger.warn(`[FeedStore] ⚠️ Possible CORS issue - check if ${item.src} allows cross-origin requests`);
          }
          
          // Remove previous model if we kept it visible (since we're showing error now)
          if (this.previousGLTF) {
            this.removeModel(this.previousGLTF);
            this.previousGLTF = undefined;
          }
          
          // Only show error placeholder on actual error (not just "loading")
          throw loadError;
        }
      } else if (item.type === 'gaussianSplat') {
        // GAUSSIAN-SPLAT: Load Gaussian Splat content using supersplat-viewer
        // Local test asset: public/assets/aigengsplat.ply (129.70 MB - too large for GitHub, must be added locally)
        // The file is not committed to git due to size limits - ensure it exists locally for testing
        logger.verbose(`[FeedStore] 🔄 Loading Gaussian Splat: "${item.title}" from ${item.src}`);
        try {
          const splatAsset = await this.ensureGaussianSplatLoader().load(item.src, item.settingsUrl);
          logger.verbose(`[FeedStore] ✅ Successfully loaded Gaussian Splat: ${item.title}`);
          
          // Show the splat viewer
          splatAsset.show();
          
          // Store reference for cleanup
          this.currentGaussianSplat = {
            asset: splatAsset,
            dispose: () => {
              splatAsset.hide();
              splatAsset.dispose();
            },
          };
          
          // Preload upcoming models
          this.preloadUpcomingModels(3);
        } catch (loadError: any) {
          // GAUSSIAN-SPLAT: Enhanced error logging for debugging renderer issues
          logger.error(`[FeedStore] ❌ FAILED to load Gaussian Splat: ${item.title}`, loadError);
          logger.error(`[FeedStore] Gaussian Splat URL: ${item.src}`);
          logger.error(`[FeedStore] Error details:`, {
            message: loadError?.message || String(loadError),
            name: loadError?.name,
            stack: loadError?.stack,
            url: item.src,
            settingsUrl: item.settingsUrl
          });
          
          // Check for common issues
          if (loadError?.message?.includes('timeout')) {
            logger.warn(`[FeedStore] ⚠️ Gaussian Splat load timeout - file may be too large or network slow`);
          } else if (loadError?.message?.includes('CORS') || loadError?.message?.includes('fetch')) {
            logger.warn(`[FeedStore] ⚠️ Gaussian Splat CORS/network issue - check if ${item.src} is accessible`);
          } else if (loadError?.message?.includes('404') || loadError?.message?.includes('Not Found')) {
            logger.warn(`[FeedStore] ⚠️ Gaussian Splat file not found - ensure ${item.src} exists locally`);
          }
          
          // Re-throw to trigger error placeholder
          throw loadError;
        }
      } else {
        // generic mesh fallback
        const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const mat = new THREE.MeshStandardMaterial({ color: 0x66ccff });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = 'content-mesh';
        mesh.position.copy(spawnPos);
        this.parent.add(mesh);
      }
    } catch (error) {
      logError(error, 'FeedStore.showCurrent');
      this.toast('❌ Failed to load content');
      
      // Show error placeholder (solid, not wireframe for better visibility)
      const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const mat = new THREE.MeshStandardMaterial({ 
        color: 0xff3344, 
        wireframe: false,
        emissive: 0x330000,
        roughness: 0.5
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'content-error';
      mesh.position.copy(spawnPos);
      this.parent.add(mesh);
    }

    // Defer platform update to next frame to avoid blocking
    requestAnimationFrame(() => {
      try {
        this.ensurePlatform();
        this.updatePlatformPose();
      } catch (error) {
        logError(error, 'FeedStore.showCurrent platform update');
      }
    });

    // Safe string formatting - don't toast during tutorial to avoid blocking
    // Only toast if not in tutorial mode (we can detect this by checking if index is in first 3 items)
    const isTutorialItem = this.index < 3 && this.items[this.index]?.type === 'shape';
    if (!isTutorialItem) {
      const title = item.title || 'Untitled';
      const author = item.author || 'Unknown';
      this.toast(`${title} — @${author}`);
    }
    } finally {
      this.isLoading = false;
    }
  }

  next(delta: number) {
    if (!this.items.length) {
      this.toast('⚠️ No items in feed');
      return;
    }
    const oldIndex = this.index;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    
    // Prevent infinite loops if only one item
    if (this.items.length === 1) {
      this.index = 0;
      return;
    }
    
    // Only update if index actually changed
    if (this.index !== oldIndex) {
      const item = this.items[this.index];
      
      // OPTIMIZATION: Start preloading next model immediately on scroll (before cleanup delay)
      // This makes the next model appear instantly when user scrolls again
      // Use the new asset manager for efficient preloading
      if (delta > 0) {
        // Scrolling forward - preload next items
        this.preloadUpcomingModels(3);
        // Also schedule preloads for individual items (handles both GLTF and Gaussian Splats)
        for (let offset = 1; offset <= 3; offset++) {
          const idx = (this.index + offset) % this.items.length;
          this.schedulePreload(idx);
        }
      } else {
        // Scrolling backward - preload previous items
        const urls: string[] = [];
        for (let offset = 1; offset <= 2; offset++) {
          const idx = (this.index - offset + this.items.length) % this.items.length;
          const item = this.items[idx];
          if (item && (item.type === 'gltf' || item.type === 'glb')) {
            urls.push(item.src);
          }
          // Also schedule preload for Gaussian Splats
          this.schedulePreload(idx);
        }
        if (urls.length > 0) {
          this.ensureAssetManager().preloadMany(urls);
        }
      }
      
      // FIX #1: PRESERVE spatial placement - new models spawn where user placed the previous one
      // DO NOT reset lastPlaced - this is a feature, not a bug!
      // User wants new models to appear at the same location they placed the previous model
      
      // CRITICAL FIX: DON'T reset scale to 1 - this causes models to expand unexpectedly
      // Instead, reset rotation only but keep scale at default (1)
      // User's manual scaling is for the current model only, not carried to next model
      this._scale = 1;
      this._rotY = 0;
      this.targetScale = 1;
      this.targetRotY = 0;
      
      // ENHANCED: Longer delay to ensure complete cleanup
      // Previous models must be fully removed before new ones load
      setTimeout(() => {
        // Force garbage collection hint (helps with memory cleanup)
        if (this.currentGLTF) {
          this.currentGLTF = undefined;
        }
        
        // CRITICAL: Always call showCurrent - don't let errors prevent scrolling
        this.showCurrent().catch(err => {
          logError(err, 'FeedStore.next');
          // Continue anyway - don't block scrolling
        });
      }, 150); // INCREASED from 50ms to 150ms for better cleanup
    }
  }

  setTargetTransform(scale: number, rotY: number) {
    // No scale limits - allow unlimited scaling
    this.targetScale = Math.max(0.001, scale); // Only prevent negative/zero scale
    this.targetRotY = rotY;
  }

  setTransform(scale: number, rotY: number) {
    // No scale limits - allow unlimited scaling
    this._scale = Math.max(0.001, scale); // Only prevent negative/zero scale
    this._rotY = rotY;
    const obj = this.getObject();
    if (obj) {
      // CRITICAL FIX: For GLTF models, apply user scale on top of base auto-scale
      if (obj.name === 'content-gltf' && (obj as any)._baseAutoScale) {
        const baseScale = (obj as any)._baseAutoScale;
        obj.scale.setScalar(baseScale * this._scale);
      } else {
        obj.scale.setScalar(this._scale);
      }
      obj.rotation.y = this._rotY;
    }
    if (this.seq) this.seq.setTransform(this._scale, this._rotY);
    if (this.currentGLTF) {
      // CRITICAL FIX: Apply user scale on top of base auto-scale for GLTF
      if ((this.currentGLTF as any)._baseAutoScale) {
        const baseScale = (this.currentGLTF as any)._baseAutoScale;
        this.currentGLTF.scale.setScalar(baseScale * this._scale);
      } else {
        this.currentGLTF.scale.setScalar(this._scale);
      }
      this.currentGLTF.rotation.y = this._rotY;
    }
    this.updatePlatformPose();
  }

  tick(dt: number) {
    const k = 1 - Math.pow(0.02, dt);
    this._scale += (this.targetScale - this._scale) * k;
    this._rotY += (this.targetRotY - this._rotY) * k;

    // OPTIMIZATION: Only update if transform actually changed (avoid unnecessary work)
    const scaleChanged = Math.abs(this._scale - this.targetScale) > 0.001;
    const rotChanged = Math.abs(this._rotY - this.targetRotY) > 0.001;
    
    if (scaleChanged || rotChanged) {
      const obj = this.getObject();
      if (obj) {
        // CRITICAL FIX: For GLTF models, apply user scale on top of base auto-scale
        if (obj.name === 'content-gltf' && (obj as any)._baseAutoScale) {
          const baseScale = (obj as any)._baseAutoScale;
          obj.scale.setScalar(baseScale * this._scale);
        } else {
          obj.scale.setScalar(this._scale);
        }
        obj.rotation.y = this._rotY;
      }
      if (this.seq) this.seq.setTransform(this._scale, this._rotY);
      
      // Update GLTF separately if it exists
      if (this.currentGLTF) {
        // CRITICAL FIX: Apply user scale on top of base auto-scale for GLTF
        if ((this.currentGLTF as any)._baseAutoScale) {
          const baseScale = (this.currentGLTF as any)._baseAutoScale;
          this.currentGLTF.scale.setScalar(baseScale * this._scale);
        } else {
          this.currentGLTF.scale.setScalar(this._scale);
        }
        this.currentGLTF.rotation.y = this._rotY;
      }
      
      // Update platform pose when transform changes
      this.updatePlatformPose();
    }

    // update transient effects
    for (let i = this.effects.length - 1; i >= 0; --i) {
      const e = this.effects[i];
      e.life -= dt;

      if (e.sprite && e.vel && e.life > 0) {
        e.sprite.position.addScaledVector(e.vel, dt);
        (e.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, Math.max(0, e.life * 2));
      }

      if (e.mesh) {
        const t = Math.max(0, e.life);
        e.mesh.scale.setScalar(1 + (1 - t) * 1.5);

        const matAny = e.mesh.material as THREE.Material | THREE.Material[];
        const setMat = (m: THREE.Material) => {
          m.transparent = true;
          (m as any).opacity = 0.55 * t;
          const msm = m as unknown as THREE.MeshStandardMaterial;
          if (typeof msm.emissiveIntensity === 'number') msm.emissiveIntensity = 3.2 * t;
        };
        if (Array.isArray(matAny)) matAny.forEach(setMat);
        else setMat(matAny);
      }

      if (e.life <= 0) {
        if (e.sprite) {
          this.parent.remove(e.sprite);
          e.tex?.dispose();
          (e.sprite.material as any).dispose?.();
        }
        if (e.mesh) {
          this.parent.remove(e.mesh);
          (e.mesh.geometry as any).dispose?.();
          const matAny = e.mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(matAny)) matAny.forEach((m) => (m as any).dispose?.());
          else (matAny as any).dispose?.();
        }
        this.effects.splice(i, 1);
      }
    }
  }

  /**
   * Preload a range of upcoming feed items (GLB/GLTF only) so that once the
   * user scrolls past the current object, the next assets display instantly.
   */
  preloadRange(startIndex: number, count = 2) {
    this.preloadModelsFrom(startIndex, count);
  }

  private ensureGLTFLoader(): GLTFModelLoader {
    if (!this.gltfLoader) {
      this.gltfLoader = new GLTFModelLoader();
    }
    return this.gltfLoader;
  }

  private ensureAssetManager(): ModelAssetManager {
    if (!this.assetManager) {
      this.assetManager = new ModelAssetManager(3); // Max 3 concurrent loads
    }
    return this.assetManager;
  }

  private ensureGaussianSplatLoader(): GaussianSplatLoader {
    if (!this.gaussianSplatLoader) {
      this.gaussianSplatLoader = new GaussianSplatLoader();
    }
    return this.gaussianSplatLoader;
  }

  /**
   * Dispose resources (called when FeedStore is no longer needed)
   */
  dispose(): void {
    if (this.currentGaussianSplat) {
      this.currentGaussianSplat.dispose();
      this.currentGaussianSplat = undefined;
    }
    if (this.assetManager) {
      this.assetManager.dispose();
      this.assetManager = undefined;
    }
    if (this.gltfLoader) {
      this.gltfLoader.dispose();
      this.gltfLoader = undefined;
    }
    if (this.gaussianSplatLoader) {
      this.gaussianSplatLoader.dispose();
      this.gaussianSplatLoader = undefined;
    }
    if (this.seq) {
      this.seq.dispose();
      this.seq = undefined;
    }
  }

  /**
   * Helper to remove and dispose a model cleanly
   */
  private removeModel(model: THREE.Object3D): void {
    // Stop and dispose animation mixer if present
    if ((model as any).mixer) {
      (model as any).mixer.stopAllAction();
      (model as any).mixer = null;
    }
    
    // RECURSIVE disposal for GLTF models with children
    model.traverse((node: THREE.Object3D) => {
      // Dispose geometry
      if ((node as any).geometry) {
        (node as any).geometry.dispose();
      }
      
      // Dispose material(s)
      const mat = (node as any).material;
      if (mat) {
        if (Array.isArray(mat)) {
          mat.forEach(m => {
            // Dispose textures
            if (m.map) m.map.dispose();
            if (m.lightMap) m.lightMap.dispose();
            if (m.bumpMap) m.bumpMap.dispose();
            if (m.normalMap) m.normalMap.dispose();
            if (m.specularMap) m.specularMap.dispose();
            if (m.envMap) m.envMap.dispose();
            m.dispose();
          });
        } else {
          // Dispose textures
          if (mat.map) mat.map.dispose();
          if (mat.lightMap) mat.lightMap.dispose();
          if (mat.bumpMap) mat.bumpMap.dispose();
          if (mat.normalMap) mat.normalMap.dispose();
          if (mat.specularMap) mat.specularMap.dispose();
          if (mat.envMap) mat.envMap.dispose();
          mat.dispose();
        }
      }
    });
    
    // Remove from parent
    this.parent.remove(model);
    logger.verbose(`[FeedStore] ✅ Removed and disposed model: ${model.name}`);
  }

  /**
   * AUTO-SCALE SYSTEM for GLTF/GLB models
   * FIX #2: Improved scaling to better fit user's POV
   * Target: Models should be comfortably visible at arm's reach (50-60cm)
   */
  private calculateOptimalScale(model: THREE.Object3D): { scale: number; originalSize: number } {
    // Calculate bounding box of the entire model
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    
    // Get the largest dimension (width, height, or depth)
    const maxDimension = Math.max(size.x, size.y, size.z);
    
    // If model is tiny or has no dimensions, use default scale
    if (maxDimension < 0.001) {
      logger.warn('[Auto-Scale] Model has no measurable size, using default scale');
      return { scale: 1.0, originalSize: 0 };
    }
    
    // FIX #2: IMPROVED target size for better screen fit
    // Target: 0.35m (35cm) for largest dimension
    // This ensures models are:
    // - Large enough to see details clearly
    // - Small enough to fit comfortably in user's POV
    // - Optimized for arm's reach interaction (~60cm from face)
    // - REDUCED from 0.4m to prevent models from getting too close to edges
    const TARGET_SIZE = 0.35;
    
    // Calculate scale factor needed
    const scaleFactor = TARGET_SIZE / maxDimension;
    
    // FIX #2: Adjusted clamp bounds for better scaling
    // Min: 0.05 (prevent ultra-tiny invisible models)
    // Max: 100 (allow scaling up very small models like insects)
    const clampedScale = Math.max(0.05, Math.min(100, scaleFactor));
    
    // Log for debugging (verbose only)
    logger.verbose('[Auto-Scale]', {
      originalSize: `${maxDimension.toFixed(3)}m`,
      targetSize: `${TARGET_SIZE}m`,
      calculatedScale: scaleFactor.toFixed(3),
      finalScale: clampedScale.toFixed(3),
      dimensions: {
        x: size.x.toFixed(3),
        y: size.y.toFixed(3),
        z: size.z.toFixed(3)
      }
    });
    
    return {
      scale: clampedScale,
      originalSize: maxDimension
    };
  }

  private preloadNextModels(count = 2) {
    if (!this.items.length) return;
    this.preloadModelsFrom(this.index + 1, count);
  }

  private preloadModelsFrom(startIndex: number, count: number) {
    const maxIndex = this.items.length - 1;
    if (maxIndex < 0) return;

    for (let offset = 0; offset < count; offset++) {
      const idx = startIndex + offset;
      if (idx < 0 || idx > maxIndex) break;
      this.schedulePreload(idx);
    }
  }

  private schedulePreload(index: number) {
    const item = this.items[index];
    if (!item) {
      return;
    }
    
    // Preload GLTF/GLB models
    if (item.type === 'glb' || item.type === 'gltf') {
      if (this.preloadInFlight.has(index)) {
        return;
      }
      this.preloadInFlight.add(index);
      this.ensureAssetManager()
        .preload(item.src)
        .catch((err) => {
          logError(err, `FeedStore.preload:${item.id}`);
        })
        .finally(() => this.preloadInFlight.delete(index));
    }
    
    // Preload Gaussian Splats
    if (item.type === 'gaussianSplat') {
      if (this.preloadInFlight.has(index)) {
        return;
      }
      this.preloadInFlight.add(index);
      this.ensureGaussianSplatLoader()
        .preload(item.src, item.settingsUrl)
        .catch((err) => {
          logError(err, `FeedStore.preload:${item.id}`);
        })
        .finally(() => this.preloadInFlight.delete(index));
    }
  }

  /**
   * Preload upcoming GLTF/GLB models and Gaussian Splats based on current index and scroll direction
   */
  private preloadUpcomingModels(count = 3) {
    if (!this.items.length) return;
    
    const gltfUrls: string[] = [];
    for (let offset = 1; offset <= count; offset++) {
      const idx = (this.index + offset) % this.items.length;
      const item = this.items[idx];
      if (item && (item.type === 'gltf' || item.type === 'glb')) {
        gltfUrls.push(item.src);
      }
      // Gaussian Splats are preloaded via schedulePreload which is called separately
    }
    
    if (gltfUrls.length > 0) {
      this.ensureAssetManager().preloadMany(gltfUrls);
    }
  }

  setPosition(worldPos: THREE.Vector3) {
    try {
      const obj = this.getObject();
      if (obj) {
        const actualParent = obj.parent || this.parent;
        
        // CRITICAL FIX: Update parent's matrix FIRST before converting world to local
        // This ensures worldToLocal uses the correct, up-to-date transformation matrix
        if (actualParent) {
          // Update parent's world matrix to ensure it's current
          actualParent.updateMatrixWorld(true);
        }
        
        // Convert world position to local position relative to parent
        const localPos = worldPos.clone();
        if (actualParent) {
          // Now convert using the updated matrix
          actualParent.worldToLocal(localPos);
        }
        
        // Set the position
        obj.position.copy(localPos);
        
        // Update this object's local matrix
        obj.updateMatrix();
        // Force update this object's world matrix to reflect the new position
        obj.updateMatrixWorld(true);
      } else {
        // Debug: log when object not found (throttled)
        if (Math.random() < 0.1) {
          logger.warn(`[FeedStore] setPosition: Object not found! Available children:`, this.parent.children.map(c => c.name).join(', '));
        }
      }
      if (this.seq) {
        this.seq.setPosition(worldPos);
      }
      // Store last placed position with timestamp to detect recent placements
      this.lastPlaced = worldPos.clone();
      (this.lastPlaced as any)._timestamp = performance.now();
      this.updatePlatformPose();
    } catch (error) {
      logError(error, 'FeedStore.setPosition');
      logger.error('[FeedStore] setPosition error:', error);
    }
  }

  getStateSnapshot() {
    const pos = this.getObjectWorldPos();
    return {
      index: this.index,
      itemId: this.items[this.index]?.id ?? null,
      // CRITICAL FIX: Do NOT include position, scale, rotationY in snapshot
      // Each user controls their own model transforms locally
      // Only sync content (index/itemId), not spatial transforms
      position: null, // Removed - each user controls own position
      scale: 1.0, // Removed - each user controls own scale
      rotationY: 0, // Removed - each user controls own rotation
      timestamp: performance.now(),
    };
  }

  // CRITICAL FIX: Throttle remote state updates to prevent flickering
  private lastRemoteStateUpdate = 0;
  private readonly REMOTE_STATE_THROTTLE_MS = 100; // Max 10 updates per second
  private pendingRemoteState: { index: number; itemId: string | null; position?: { x: number; y: number; z: number } | null; scale?: number; rotationY?: number } | null = null;
  
  async applyRemoteState(state: {
    index: number;
    itemId: string | null;
    position?: { x: number; y: number; z: number } | null; // Optional - not synced
    scale?: number; // Optional - not synced
    rotationY?: number; // Optional - not synced
  }): Promise<void> {
    try {
      const now = performance.now();
      
      // CRITICAL FIX: Throttle updates to prevent flickering from rapid network updates
      if (now - this.lastRemoteStateUpdate < this.REMOTE_STATE_THROTTLE_MS) {
        // Store pending state and apply on next throttle window
        this.pendingRemoteState = state;
        return;
      }
      
      // Apply pending state if exists
      if (this.pendingRemoteState) {
        state = this.pendingRemoteState;
        this.pendingRemoteState = null;
      }
      
      this.lastRemoteStateUpdate = now;
      
      // ENHANCED: Match by itemId first (more reliable than index), fallback to index
      let targetIndex = this.index;
      
      if (state.itemId) {
        // Try to find item by ID
        const itemIndex = this.items.findIndex(item => item.id === state.itemId);
        if (itemIndex >= 0) {
          targetIndex = itemIndex;
        } else {
          // Item ID not found, use index as fallback
          const clampedIndex = Math.max(0, Math.min(state.index ?? this.index, this.items.length - 1));
          if (Number.isFinite(clampedIndex)) {
            targetIndex = clampedIndex;
          }
        }
      } else {
        // No itemId, use index
        const clampedIndex = Math.max(0, Math.min(state.index ?? this.index, this.items.length - 1));
        if (Number.isFinite(clampedIndex)) {
          targetIndex = clampedIndex;
        }
      }
      
      // CRITICAL FIX: Only change feed item if index actually changed AND we're not currently loading
      // This prevents flickering from rapid index changes
      if (this.items.length > 0 && targetIndex !== this.index && !this.isLoading) {
        this.index = targetIndex;
        await this.showCurrent();
      }

      // CRITICAL FIX: Each user controls their own model transforms locally
      // Do NOT apply remote position/scale/rotation - this prevents host from controlling everyone's model
      // Only sync content (index/itemId), not spatial transforms
      // This eliminates flickering and gives each user independent control
      
      // Position, scale, and rotation are now LOCAL ONLY - not synced
      // Each user can position/rotate/scale their own model independently
    } catch (error) {
      logError(error, 'FeedStore.applyRemoteState');
    }
  }

  getObject(): THREE.Object3D | undefined {
    try {
      const found = this.parent.children.find(
        (c) => c.name === 'content-shape' || c.name === 'content-mesh' || c.name === 'content-gltf'
      );
      if (found) return found;

      // Don't return platform as the main object
      return undefined;
    } catch (error) {
      logError(error, 'FeedStore.getObject');
      return undefined;
    }
  }

  // CRITICAL FIX: Enhanced null safety
  getObjectWorldPos(): THREE.Vector3 | null {
    const obj = this.getObject();
    if (obj) {
      // FIX #3: Ensure matrix is updated before getting world position
      obj.updateMatrixWorld(true);
      const worldPos = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
      logger.verbose(`[FeedStore] Object world pos: (${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)})`);
      return worldPos;
    }
    if (this.lastPlaced) {
      logger.verbose(`[FeedStore] Using lastPlaced for world pos`);
      return this.lastPlaced.clone();
    }
    logger.warn(`[FeedStore] No object or lastPlaced for world pos`);
    return null;
  }

  getObjectBounds(): { center: THREE.Vector3; radius: number; box: THREE.Box3 } | null {
    try {
      const obj = this.getObject();
      if (!obj || !obj.visible) return null;
      const box = new THREE.Box3().setFromObject(obj);
      if (!box || box.isEmpty()) return null; // Check for invalid bounds
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = size.length() * 0.5;
      if (!Number.isFinite(radius) || radius <= 0) return null; // Validate radius
      return { center, radius, box };
    } catch (error) {
      logError(error, 'FeedStore.getObjectBounds');
      return null;
    }
  }

  // ---------- Reactions ----------
  likeCurrent(fromHand?: THREE.Vector3, _side: 'left' | 'right' = 'right') {
    this.toast('👍 Liked');
    if (fromHand instanceof THREE.Vector3) {
      this.launchEmoji(fromHand, '👍', '#ffd400');
    }
    this.platformPulse(0xffff00);
  }

  saveCurrent(fromHand?: THREE.Vector3) {
    this.toast('❤️ Saved');
    if (fromHand instanceof THREE.Vector3) {
      this.launchEmoji(fromHand, '❤️', '#ff3355');
    }
    this.platformPulse(0xff3344);
  }

  /** Peace-sign gesture action → show repost feedback. */
  repostCurrent(fromHand?: THREE.Vector3, _side: 'left' | 'right' = 'right') {
    this.toast('🔁 Reposted');
    if (fromHand instanceof THREE.Vector3) {
      this.launchEmoji(fromHand, '🔁', '#66e0ff');
    }
    this.platformPulse(0x66e0ff);
  }

  public notify(msg: string) { this.onHud?.(msg); }
  private toast(msg: string) { this.onHud?.(msg); }

  // ---------- Platform ----------
  private ensurePlatform() {
    if (this.platform) return;
    const geo = new THREE.CircleGeometry(0.45, 56);
    this.platform = new THREE.Mesh(geo, this.platformMat.clone());
    this.platform.rotation.x = -Math.PI * 0.5;
    this.platform.renderOrder = -1;
    this.platform.name = 'content-platform';
    this.parent.add(this.platform);
  }

  private updatePlatformPose() {
    if (!this.platform) return;
    try {
      const info = this.getObjectBounds();
      if (!info) {
        this.platform.visible = false;
        return;
      }
      const { box } = info;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      this.platform.position.set(center.x, box.min.y - 0.02, center.z);
      const r = Math.max(size.x, size.z) * 0.35;
      this.platform.scale.setScalar(Math.max(0.2, r));
      this.platform.visible = true;
    } catch (error) {
      logError(error, 'FeedStore.updatePlatformPose');
      this.platform.visible = false;
    }
  }

  // ---------- Platform pulse ----------
  private platformPulse(color: number) {
    this.ensurePlatform();
    if (!this.platform) return;

    const mat = this.platform.material as THREE.MeshStandardMaterial;
    const base = {
      color: 0x111111,
      emissive: 0x000000,
      opacity: 0.15,
      emissiveIntensity: 0.0,
    };

    // brief highlight on the platform
    mat.color.set(0x111111);
    mat.emissive.setHex(color);
    mat.emissiveIntensity = 3.2;
    mat.opacity = 0.5;

    // expanding ring effect
    const ringGeo = new THREE.RingGeometry(0.18, 0.20, 56);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x0,
      emissive: new THREE.Color(color),
      emissiveIntensity: 3.2,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.copy(this.platform.position);
    this.parent.add(ring);

    // fade/cleanup handled by tick()
    this.effects.push({ mesh: ring, life: 0.7 });

    // restore base look shortly after
    setTimeout(() => {
      mat.opacity = base.opacity;
      mat.emissiveIntensity = base.emissiveIntensity;
      mat.emissive.setHex(base.emissive);
      mat.color.set(base.color);
    }, 450);
  }

  // ---------- Emoji projectile ----------
  private launchEmoji(start: THREE.Vector3, emoji: string, fill: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '200px sans-serif';
    ctx.fillStyle = fill;
    ctx.fillText(emoji, 128, 138);

    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 1 })
    );
    spr.scale.set(0.3, 0.3, 0.3);
    spr.position.copy(start);
    this.parent.add(spr);

    const to = this.getObjectWorldPos();
    if (!to) return;

    const dir = to.clone().sub(start);
    const dist = dir.length();
    dir.normalize();
    const speed = Math.max(0.0001, dist / 0.35);
    this.effects.push({ sprite: spr, vel: dir.multiplyScalar(speed), life: 0.45, tex });
  }

  // ---------- Shapes ----------
  private resolveAssetUrl(subpath: string) {
    const base = (import.meta as any).env?.BASE_URL ?? '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const normalizedSubpath = subpath.startsWith('/') ? subpath.slice(1) : subpath;
    return `${normalizedBase}${normalizedSubpath}`;
  }

  // NASA Blue Marble imagery (public domain) stored at /assets/earth_daymap.jpg.
  private getEarthTexture(): THREE.Texture | undefined {
    if (this.earthTextureFailed) return undefined;
    if (!this.earthTexture) {
      try {
        const texture = this.textureLoader.load(
          this.resolveAssetUrl('assets/earth_daymap.jpg'),
          (loaded) => {
            loaded.colorSpace = THREE.SRGBColorSpace;
            loaded.needsUpdate = true;
          },
          undefined,
          (error) => {
            logger.warn('[FeedStore] Failed to load Earth texture', error);
            this.earthTexture = undefined;
            this.earthTextureFailed = true;
          }
        );
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.center.set(0.5, 0.5);
        texture.repeat.set(1, 1);
        this.earthTexture = texture;
      } catch (error) {
        logger.warn('[FeedStore] Error initializing Earth texture', error);
        this.earthTexture = undefined;
        this.earthTextureFailed = true;
      }
    }
    return this.earthTexture;
  }

  // Egyptian pyramid photo by Unsplash contributor (CC0-equivalent license).
  private getPyramidTexture(): THREE.Texture | undefined {
    if (this.pyramidTextureFailed) return undefined;
    if (!this.pyramidTexture) {
      try {
        const texture = this.textureLoader.load(
          this.resolveAssetUrl('assets/egypt_pyramids.jpg'),
          (loaded) => {
            loaded.colorSpace = THREE.SRGBColorSpace;
            loaded.needsUpdate = true;
          },
          undefined,
          (error) => {
            logger.warn('[FeedStore] Failed to load pyramid texture', error);
            this.pyramidTexture = undefined;
            this.pyramidTextureFailed = true;
          }
        );
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.center.set(0.5, 0.5);
        texture.repeat.set(1, 1);
        this.pyramidTexture = texture;
      } catch (error) {
        logger.warn('[FeedStore] Error initializing pyramid texture', error);
        this.pyramidTexture = undefined;
        this.pyramidTextureFailed = true;
      }
    }
    return this.pyramidTexture;
  }

  private makeShape(kind: ShapeKind, colorHex?: string, sourceId?: string) {
    const color = new THREE.Color(colorHex ?? '#66ccff');
    let mat: THREE.MeshStandardMaterial;
    if (kind === 'sphere' && sourceId === 'shape-blue-sphere') {
      const earthTexture = this.getEarthTexture();
      if (earthTexture) {
        mat = new THREE.MeshStandardMaterial({
          map: earthTexture,
          roughness: 0.55,
          metalness: 0.05,
          emissive: 0x000000,
        });
      } else {
        mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0.0,
          emissive: 0x000000,
        });
      }
    } else if (kind === 'pyramid' && sourceId === 'shape-egyptian-pyramid') {
      const pyramidTexture = this.getPyramidTexture();
      if (pyramidTexture) {
        mat = new THREE.MeshStandardMaterial({
          map: pyramidTexture,
          roughness: 0.6,
          metalness: 0.05,
          emissive: 0x000000,
        });
      } else {
        mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.45,
          metalness: 0.05,
          emissive: 0x000000,
        });
      }
    } else {
      mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.4,
        metalness: 0.0,
        emissive: 0x000000,
      });
    }
    let geo: THREE.BufferGeometry;
    switch (kind) {
      case 'box':
        geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        break;
      case 'sphere':
        geo = new THREE.SphereGeometry(0.25, 48, 32);
        break;
      case 'pyramid':
        geo = new THREE.ConeGeometry(0.28, 0.5, 4);
        break;
      default:
        geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        break;
    }
    return new THREE.Mesh(geo, mat);
  }
}
