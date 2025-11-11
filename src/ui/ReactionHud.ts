// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart';

export class ReactionHud {
  private anchor = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private panelTex: THREE.CanvasTexture;
  private panelCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private likeCount = 0;
  private heartCount = 0;

  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  private visible = false;
  private hideAt = 0;
  private readonly AUTO_HIDE_MS = 4000; // longer

  private readonly PANEL_W = 0.42;
  private readonly PANEL_H = 0.24;

  private readonly BASE_OFFSET = new THREE.Vector3(0, 0.18, 0);

  private orbitEnabled = true;
  private orbitRadius = 0.18;
  private orbitSpeed = 0.6;
  private theta = 0;
  private bobAmp = 0.02;
  private bobSpeed = 1.4;

  private heartIcon?: HTMLImageElement;
  private likeIcon?: HTMLImageElement;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 1024;
    this.panelCanvas.height = 512;
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
      opacity: 0.0,
      depthTest: false,   // <<< always render on top
      depthWrite: false
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999; // extra high
    this.anchor.add(this.panel);
    this.scene.add(this.anchor);

    this.redraw();
  }

  setCounts(like: number, heart: number) {
    this.likeCount = Math.max(0, Math.floor(like));
    this.heartCount = Math.max(0, Math.floor(heart));
    this.redraw();
  }

  setIcons(heartUrl?: string, likeUrl?: string) {
    const load = (name: 'heart'|'like', url?: string) => {
      if (!url) return undefined;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onerror = () => console.warn(`[ReactionHud] Icon failed to load: ${name} (${url})`);
      img.onload = () => this.redraw();
      return img;
    };
    this.heartIcon = load('heart', heartUrl);
    this.likeIcon  = load('like',  likeUrl);
  }

  show(autoHide = true) {
    if (!this.visible) { this.visible = true; this.fadeTo(1.0, 160); }
    if (autoHide) this.hideAt = performance.now() + this.AUTO_HIDE_MS;
  }
  hide() { if (this.visible) { this.visible = false; this.fadeTo(0.0, 160); } }

  flash(kind: ReactionKind) {
    this.spawnChip(kind);
    this.show(true);
  }

  tick(dt: number) {
    const center = this.getObjectWorldPos?.();
    if (center) {
      if (this.orbitEnabled) {
        this.theta += this.orbitSpeed * dt;
        const ox = Math.cos(this.theta) * this.orbitRadius;
        const oz = Math.sin(this.theta) * this.orbitRadius;
        const yBob = Math.sin(this.theta * this.bobSpeed) * this.bobAmp;
        const offset = new THREE.Vector3(ox, this.BASE_OFFSET.y + yBob, oz);
        this.anchor.position.copy(center).add(offset);
      } else {
        this.anchor.position.copy(center).add(this.BASE_OFFSET);
      }
    }
    this.anchor.quaternion.copy(this.camera.quaternion);

    if (this.visible && performance.now() >= this.hideAt) this.hide();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { p.sprite.parent?.remove(p.sprite); this.particles.splice(i, 1); continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.ttl / 0.6);
    }
  }

  // ---------- drawing ----------
  private redraw() {
    const c = this.panelCanvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    this.rounded(ctx, 0, 0, c.width, c.height, 36);
    ctx.fillStyle = 'rgba(18,18,28,0.92)'; ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '700 34px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Reactions', c.width / 2, 64);

    const rowY = 180;
    const gap = 140;
    const iconSize = 110;

    const heartX = c.width / 2 - gap;
    this.drawIconWithCounter(
      this.heartIcon, '❤️', heartX, rowY, iconSize, this.heartCount
    );

    const likeX = c.width / 2 + gap;
    this.drawIconWithCounter(
      this.likeIcon, '👍', likeX, rowY, iconSize, this.likeCount
    );

    this.panelTex.needsUpdate = true;
  }

  private drawIconWithCounter(img: HTMLImageElement | undefined, fallbackEmoji: string, cx: number, cy: number, size: number, count: number) {
    const ctx = this.ctx;
    const half = size / 2;

    this.rounded(ctx, cx - half, cy - half, size, size, size * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, cx - half, cy - half, size, size);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.floor(size * 0.78)}px system-ui,emoji`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fallbackEmoji, cx, cy + 8);
    }

    ctx.fillStyle = '#fff';
    ctx.font = '700 36px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(count), cx, cy + half + 48);
  }

  private spawnChip(kind: 'like'|'heart') {
    const canv = document.createElement('canvas'); canv.width = 512; canv.height = 192;
    const cx = canv.getContext('2d')!; cx.clearRect(0,0,canv.width,canv.height);
    cx.fillStyle = 'rgba(255,255,255,0.28)';
    const r=36,w=canv.width,h=canv.height;
    cx.beginPath(); cx.moveTo(r,0);
    cx.arcTo(w,0,w,h,r); cx.arcTo(w,h,0,h,r); cx.arcTo(0,h,0,0,r); cx.arcTo(0,0,w,0,r);
    cx.closePath(); cx.fill();
    cx.fillStyle='#fff'; cx.font='800 64px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    cx.textAlign='center'; cx.textBaseline='middle';
    cx.fillText(kind==='like'?'+1 👍':'+1 ❤️', w/2, h/2);

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

  private fadeTo(target:number, ms:number){
    const mat = this.panel.material; const start = mat.opacity; const t0 = performance.now();
    const step=()=>{ const t=(performance.now()-t0)/ms; const k=Math.min(1,Math.max(0,t)); mat.opacity=start+(target-start)*k; if(k<1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
