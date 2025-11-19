// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart' | 'repost';
export type Comment = { id: string; author?: string; text: string };

/** Which thing on the HUD was hit. */
export type HudHit =
  | { kind: 'like' | 'heart' | 'repost'; point?: THREE.Vector3 }
  | null;

type Hit =
  | { kind: 'like' | 'heart' | 'repost' }
  | null;

export class ReactionHud {
  private anchor = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private panelTex: THREE.CanvasTexture;
  private panelCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // counters
  private likeCount = 0;
  private heartCount = 0;
  private repostCount = 0;



  // particles (chips)
  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  // Panel geometry in meters (drawn to canvas) - SQUARE for camera overlay
  readonly PANEL_W = 0.20;
  readonly PANEL_H = 0.20;

  // high-res canvas for crisp text - SQUARE layout
  private readonly CANVAS_W = 512;
  private readonly CANVAS_H = 512;

  // Position offset (to the left of model, vertically centered)
  private readonly OFFSET = new THREE.Vector3(-0.35, 0.05, 0);
  
  // Camera overlay mode - HUD always in front of camera like a filter
  private cameraOverlayMode = false;
  private camera: THREE.Camera | null = null;

  // icons (optional)
  private heartIcon?: HTMLImageElement;
  private likeIcon?: HTMLImageElement;
  private repostIcon?: HTMLImageElement;

  // cached layout rects (canvas pixel coords)
  private heartRect!: {x:number;y:number;w:number;h:number};
  private likeRect!: {x:number;y:number;w:number;h:number};
  private repostRect!: {x:number;y:number;w:number;h:number};
  private commentsRect!: {x:number;y:number;w:number;h:number};

  // small thickness to consider Z proximity for hits (meters)
  private readonly HIT_THICKNESS = 0.08;

  constructor(
    private scene: THREE.Scene,
    camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.camera = camera;
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = this.CANVAS_W;
    this.panelCanvas.height = this.CANVAS_H;
    const ctx = this.panelCanvas.getContext('2d');
    if (!ctx) throw new Error('ReactionHud: cannot get 2D context');
    this.ctx = ctx;

    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.minFilter = THREE.LinearFilter;
    this.panelTex.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.panelTex,
      transparent: true,
      opacity: 1.0,             // transparency drawn in canvas
      depthTest: true,          // Proper depth testing for MR visibility
      depthWrite: false
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999;
    this.anchor.add(this.panel);
    this.scene.add(this.anchor);

    this.redraw();
  }

  // ----------------- Public API -----------------
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) {
    const load = (url?: string) => {
      if (!url) return undefined;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onload = () => this.redraw();
      return img;
    };
    this.heartIcon  = load(heartUrl);
    this.likeIcon   = load(likeUrl);
    this.repostIcon = load(repostUrl);
  }

  setCounts(like: number, heart: number, repost: number) {
    this.likeCount   = Math.max(0, Math.floor(like));
    this.heartCount  = Math.max(0, Math.floor(heart));
    this.repostCount = Math.max(0, Math.floor(repost));
    this.redraw();
  }

  // Comments methods removed - no longer supported
  setComments(_list: Comment[]) { /* No-op */ }
  scrollComments(_steps: number) { /* No-op */ }
  appendComment(_c: Comment) { /* No-op */ }
  postQuickComment(_text = '') { /* No-op */ }

  isComposing() { return false; }

  /** Panel center in world coordinates (for aiming rays) */
  getPanelCenterWorld(): THREE.Vector3 {
    return this.anchor.position.clone();
  }

  /** Raycast in world space against the panel. */
  raycastHit(ray: THREE.Ray, thickness = 10): HudHit {
    // build plane for panel (facing camera-ish, but we keep it axis-aligned)
    const normal = new THREE.Vector3(0, 0, 1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.anchor.position);
    const hitPoint = new THREE.Vector3();
    const ok = ray.intersectPlane(plane, hitPoint);
    if (!ok) return null;

    // reject if too far from center in Z
    if (Math.abs(hitPoint.z - this.anchor.position.z) > (this.HIT_THICKNESS * (thickness/10))) return null;

    // Convert world point to panel space, then to canvas px
    const dx = hitPoint.x - this.anchor.position.x;
    const dy = hitPoint.y - this.anchor.position.y;
    if (Math.abs(dx) > this.PANEL_W * 0.5 || Math.abs(dy) > this.PANEL_H * 0.5) return null;

    const u = (dx / this.PANEL_W) + 0.5;
    const v = 0.5 - (dy / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;

    const inRect = (r:{x:number;y:number;w:number;h:number}) =>
      px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

    if (inRect(this.heartRect))  return { kind: 'heart', point: hitPoint.clone() };
    if (inRect(this.likeRect))   return { kind: 'like', point: hitPoint.clone() };
    if (inRect(this.repostRect)) return { kind: 'repost', point: hitPoint.clone() };
    return null;
  }

  /** Older helper if you only have a world point (not a ray). */
  projectHitFromPoint(p: THREE.Vector3): HudHit {
    const ray = new THREE.Ray(p.clone(), this.anchor.position.clone().sub(p).normalize());
    return this.raycastHit(ray, 10);
  }

  /** Visual chip for any reaction. */
  flash(kind: ReactionKind) {
    const text = kind === 'like' ? '+1 👍' : kind === 'heart' ? '+1 ❤️' : '+1 🔁';
    this.spawnChip(text);
  }

  /** Enable camera overlay mode - HUD always in front of camera like a filter */
  setCameraOverlayMode(enabled: boolean) {
    this.cameraOverlayMode = enabled;
  }
  
  /** Follow object position or camera (for overlay mode). */
  tick(dt: number) {
    if (this.cameraOverlayMode && this.camera) {
      try {
        // Camera overlay mode: position HUD in front of camera like a filter on headset lens
        const camPos = new THREE.Vector3();
        const camDir = new THREE.Vector3();
        const camUp = new THREE.Vector3();
        const camRight = new THREE.Vector3();
        
        this.camera.getWorldPosition(camPos);
        this.camera.getWorldDirection(camDir);
        
        // Calculate up vector from camera's matrix (getWorldUp doesn't exist in Three.js)
        // Column 1 of matrixWorld is the up vector
        if (this.camera.matrixWorld) {
          camUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
          camRight.crossVectors(camDir, camUp).normalize();
          // Recalculate up to ensure orthogonality
          camUp.crossVectors(camRight, camDir).normalize();
        } else {
          // Fallback: use default up vector if matrix not available
          camUp.set(0, 1, 0);
          camRight.crossVectors(camDir, camUp).normalize();
          camUp.crossVectors(camRight, camDir).normalize();
        }
        
        // Position 0.8m in front of camera, slightly to the left and up
        const forwardDist = 0.8;
        const leftOffset = -0.15; // Left side
        const upOffset = 0.05;    // Slightly up
        
        const forward = camDir.clone().multiplyScalar(-forwardDist);
        const left = camRight.clone().multiplyScalar(leftOffset);
        const up = camUp.clone().multiplyScalar(upOffset);
        
        this.anchor.position.copy(camPos).add(forward).add(left).add(up);
        // Always face camera
        this.anchor.lookAt(camPos);
      } catch (error) {
        // Fallback to object-relative mode on error
        console.warn('Camera overlay mode error, falling back to object-relative:', error);
        const center = this.getObjectWorldPos?.();
        if (center) {
          this.anchor.position.copy(center).add(this.OFFSET);
        }
      }
    } else {
      // Object-relative mode: follow object position
      const center = this.getObjectWorldPos?.();
      if (center) {
        this.anchor.position.copy(center).add(this.OFFSET);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { p.sprite.parent?.remove(p.sprite); this.particles.splice(i, 1); continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.ttl / 0.6);
    }
  }

  // ----------------- internals -----------------

  private hitTestWorld(worldPoint: THREE.Vector3): Hit {
    // (kept for compatibility; raycastHit() is preferred)
    const center = this.anchor.position.clone();
    const dx = worldPoint.x - center.x;
    const dy = worldPoint.y - center.y;
    const dz = worldPoint.z - center.z;
    if (Math.abs(dz) > this.HIT_THICKNESS) return null;
    if (Math.abs(dx) > this.PANEL_W * 0.5 || Math.abs(dy) > this.PANEL_H * 0.5) return null;

    const u = (dx / this.PANEL_W) + 0.5;
    const v = 0.5 - (dy / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;

    const inRect = (r:{x:number;y:number;w:number;h:number}) =>
      px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

    if (inRect(this.heartRect))  return { kind: 'heart' };
    if (inRect(this.likeRect))   return { kind: 'like' };
    if (inRect(this.repostRect)) return { kind: 'repost' };
    return null;
  }

  private redraw() {
    const c = this.panelCanvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    // Transparent background - icons only, vertically stacked in SQUARE layout
    const iconSize = 120; // Larger icons for square layout
    const baseX = (c.width - iconSize) / 2; // Center horizontally
    const gap = 20; // Vertical gap between icons
    const startY = (c.height - (iconSize * 3 + gap * 2 + 50 * 3)) / 2; // Center vertically with counters
    
    // Stack icons vertically: Heart, Like, Repost (top to bottom)
    let currentY = startY;
    this.heartRect  = this.drawIconWithCounter(this.heartIcon, '❤️', baseX, currentY, iconSize, this.heartCount);
    currentY += iconSize + 50 + gap; // icon + counter + gap
    this.likeRect   = this.drawIconWithCounter(this.likeIcon,  '👍', baseX, currentY, iconSize, this.likeCount);
    currentY += iconSize + 50 + gap;
    this.repostRect = this.drawIconWithCounter(this.repostIcon,'🔁', baseX, currentY, iconSize, this.repostCount);

    // Comments rect set to empty (no comments section)
    this.commentsRect = { x: -1, y: -1, w: 1, h: 1 };

    this.panelTex.needsUpdate = true;
  }


  private drawIconWithCounter(img: HTMLImageElement | undefined, fallbackEmoji: string, x: number, y: number, size: number, count: number) {
    const ctx = this.ctx;
    // soft tile
    this.rounded(ctx, x, y, size, size, size * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.floor(size * 0.78)}px system-ui,emoji`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fallbackEmoji, x + size/2, y + size/2 + 8);
    }

    ctx.fillStyle = '#fff';
    ctx.font = '700 32px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(count), x + size/2, y + size + 46);

    return { x, y, w: size, h: size + 50 };
  }

  private spawnChip(text: string) {
    const canv = document.createElement('canvas'); canv.width = 512; canv.height = 192;
    const cx = canv.getContext('2d')!; cx.clearRect(0,0,canv.width,canv.height);
    cx.fillStyle = 'rgba(255,255,255,0.28)';
    const r=36,w=canv.width,h=canv.height;
    cx.beginPath(); cx.moveTo(r,0);
    cx.arcTo(w,0,w,h,r); cx.arcTo(w,h,0,h,r); cx.arcTo(0,h,0,0,r); cx.arcTo(0,0,w,0,r);
    cx.closePath(); cx.fill();
    cx.fillStyle='#fff'; cx.font='800 56px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    cx.textAlign='center'; cx.textBaseline='middle';
    cx.fillText(text, w/2, h/2);

    const tex = new THREE.CanvasTexture(canv); tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1 });
    const sprite = new THREE.Sprite(mat);

    const chipW = this.PANEL_W * 0.70; const aspect = canv.height / canv.width;
    sprite.scale.set(chipW, chipW * aspect, 1); sprite.position.set(0, this.PANEL_H * 0.40, 0.002);
    this.anchor.add(sprite);

    this.particles.push({ sprite, vel: new THREE.Vector3(0, 0.25, 0), ttl: 0.9 });
  }

  private rounded(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number){
    const rr = Math.min(r, w*0.5, h*0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private wrap(ctx: CanvasRenderingContext2D, text:string, x:number, y:number, maxWidth:number, lh:number){
    ctx.textAlign = 'left';
    const words = text.split(' '); let line=''; let cy=y;
    for (let i=0;i<words.length;i++){
      const test=line+words[i]+' '; const w=ctx.measureText(test).width;
      if (w>maxWidth && i>0){ ctx.fillText(line, x, cy); line=words[i]+' '; cy+=lh; }
      else line=test;
    }
    ctx.fillText(line, x, cy);
    return cy + lh;
  }

  private measureWrappedHeight(text:string, font:string, maxWidth:number, lh:number): number {
    const ctx = this.ctx;
    ctx.font = font;
    const words = text.split(' ');
    let line = '';
    let h = 0;
    for (let i=0;i<words.length;i++){
      const test = line + words[i] + ' ';
      const w = ctx.measureText(test).width;
      if (w > maxWidth && i > 0) { h += lh; line = words[i] + ' '; }
      else line = test;
    }
    h += lh;
    return h;
  }
}
