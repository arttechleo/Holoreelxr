import * as THREE from 'three';
import { SplatSequence } from './loaders/SplatSequence';
import { GLTFModelLoader } from './loaders/GLTFLoader';
import { logError } from '../utils/errors';

type ShapeKind = 'box' | 'sphere' | 'pyramid';

type Item =
  | { id: string; title: string; author: string; type: 'shape'; shape: ShapeKind; color?: string }
  | { id: string; title: string; author: string; type: 'splat4d'; fps: number; frames: string[] }
  | { id: string; title: string; author: string; type: 'ply'; src: string }
  | { id: string; title: string; author: string; type: 'mesh'; src: string }
  | { id: string; title: string; author: string; type: 'gltf' | 'glb'; src: string };

export class FeedStore {
  items: Item[] = [];
  index = 0;

  private _scale = 1;
  private _rotY = 0;
  private targetScale = 1;
  private targetRotY = 0;
  private lastPlaced?: THREE.Vector3;

  private seq?: SplatSequence;
  private gltfLoader?: GLTFModelLoader;
  private currentGLTF?: THREE.Group;
  private onHud?: (t: string) => void;
  private parent: THREE.Object3D;

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

  async loadFeed(url = '/feed.json') {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      this.items = await res.json();
      if (!Array.isArray(this.items)) {
        throw new Error('Feed JSON is not an array');
      }
    } catch (error) {
      logError(error, 'FeedStore.loadFeed');
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
    const item = this.items[this.index];
    if (!item) {
      this.toast('No items in feed');
      this.parent.children.forEach((c) => {
        if (c.name === 'content-platform') c.visible = false;
      });
      return;
    }

    if (this.seq) {
      this.seq.dispose();
      this.seq = undefined;
    }

    // remove prior content meshes
    this.parent.children.slice().forEach((child) => {
      if (child.name === 'content-shape' || child.name === 'content-mesh' || child.name === 'content-gltf') {
        this.parent.remove(child);
        // Dispose geometry
        if ((child as any).geometry) {
          (child as any).geometry.dispose();
        }
        // Dispose material(s)
        const mat = (child as any).material;
        if (mat) {
          if (Array.isArray(mat)) {
            mat.forEach(m => m.dispose());
          } else {
            mat.dispose();
          }
        }
        // Dispose GLTF scene if it has a mixer
        if ((child as any).mixer) {
          (child as any).mixer.stopAllAction();
          (child as any).mixer = null;
        }
      }
    });

    // spawn at lastPlaced (if any) otherwise at origin
    const spawnPos = this.lastPlaced ? this.lastPlaced.clone() : new THREE.Vector3(0, 0, 0);

    try {
      if (item.type === 'shape') {
        const obj = this.makeShape(item.shape, item.color);
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
        // Load GLTF/GLB model
        if (!this.gltfLoader) {
          this.gltfLoader = new GLTFModelLoader();
        }
        const gltf = await this.gltfLoader.load(item.src);
        gltf.scene.name = 'content-gltf';
        gltf.scene.position.copy(spawnPos);
        gltf.scene.rotation.y = this._rotY;
        gltf.scene.scale.multiplyScalar(this._scale);
        this.parent.add(gltf.scene);
        this.currentGLTF = gltf.scene;
        
        // Play animations if available
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          gltf.animations.forEach((clip) => {
            mixer.clipAction(clip).play();
          });
          // Store mixer for cleanup
          (gltf.scene as any).mixer = mixer;
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
      this.setTargetTransform(1, 0);
      this.showCurrent();
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
      obj.scale.setScalar(this._scale);
      obj.rotation.y = this._rotY;
    }
    if (this.seq) this.seq.setTransform(this._scale, this._rotY);
    if (this.currentGLTF) {
      this.currentGLTF.scale.setScalar(this._scale);
      this.currentGLTF.rotation.y = this._rotY;
    }
    this.updatePlatformPose();
  }

  tick(dt: number) {
    const k = 1 - Math.pow(0.02, dt);
    this._scale += (this.targetScale - this._scale) * k;
    this._rotY += (this.targetRotY - this._rotY) * k;

    const obj = this.getObject();
    if (obj) {
      obj.scale.setScalar(this._scale);
      obj.rotation.y = this._rotY;
    }
    if (this.seq) this.seq.setTransform(this._scale, this._rotY);

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

  setPosition(worldPos: THREE.Vector3) {
    try {
      const obj = this.getObject();
      if (obj) {
        // Convert world position to local position relative to parent
        // The parent is typically the scene root, so we need to convert world to local
        const localPos = worldPos.clone();
        const actualParent = obj.parent || this.parent;
        if (actualParent) {
          actualParent.worldToLocal(localPos);
        }
        obj.position.copy(localPos);
        
        // Debug: log position updates (throttled)
        if (Math.random() < 0.05) { // 5% of calls
          console.log(`[FeedStore] setPosition: world=${worldPos.toArray().map(v => v.toFixed(2)).join(',')}, local=${localPos.toArray().map(v => v.toFixed(2)).join(',')}, obj=${obj.name}`);
        }
      } else {
        // Debug: log when object not found
        if (Math.random() < 0.1) { // 10% of calls
          console.log(`[FeedStore] setPosition: Object not found!`);
        }
      }
      if (this.seq) {
        this.seq.setPosition(worldPos);
      }
      this.lastPlaced = worldPos.clone();
      this.updatePlatformPose();
    } catch (error) {
      logError(error, 'FeedStore.setPosition');
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

  getObjectWorldPos(): THREE.Vector3 | null {
    const obj = this.getObject();
    if (obj) return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    if (this.lastPlaced) return this.lastPlaced.clone();
    return null;
  }

  getObjectBounds(): { center: THREE.Vector3; radius: number; box: THREE.Box3 } | null {
    try {
      const obj = this.getObject();
      if (!obj || !obj.visible) return null;
      const box = new THREE.Box3().setFromObject(obj);
      if (!box || !box.isFinite()) return null; // Check for invalid bounds
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = size.length() * 0.5;
      if (!isFinite(radius) || radius <= 0) return null; // Validate radius
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
  private makeShape(kind: ShapeKind, colorHex?: string) {
    const color = new THREE.Color(colorHex ?? '#66ccff');
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.0,
      emissive: 0x000000,
    });
    let geo: THREE.BufferGeometry;
    switch (kind) {
      case 'box':
        geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        break;
      case 'sphere':
        geo = new THREE.SphereGeometry(0.25, 32, 16);
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
