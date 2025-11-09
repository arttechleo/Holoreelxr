// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart';

/**
 * 3D, world-anchored reaction HUD:
 * - Billboard panel (CanvasTexture) facing the camera
 * - Shows 👍/❤️ counts and a "Comments" block
 * - bump(kind) spawns a floating "+1" sprite
 * - show()/hide() controls visibility, tick(dt) updates following & particles
 */
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
  private readonly AUTO_HIDE_MS = 2000;

  // layout / style
  private readonly PANEL_W = 0.28; // meters
  private readonly PANEL_H = 0.20;
  private readonly OFFSET = new THREE.Vector3(0, 0.16, 0); // above model center

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** world position of the *current* model (center) */
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 512;
    this.panelCanvas.height = 360;
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
      opacity: 0.0, // start hidden
      depthTest: true,
      depthWrite: false,
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 999;
    this.anchor.add(this.panel);

    this.scene.add(this.anchor);
    this.redraw();
  }

  /** Show panel and (optionally) schedule auto-hide */
  show(autoHide = true) {
    if (!this.visible) {
      this.visible = true;
      this.fadeTo(1.0, 140);
    }
    if (autoHide) this.hideAt = performance.now() + this.AUTO_HIDE_MS;
  }
  hide() {
    if (this.visible) {
      this.visible = false;
      this.fadeTo(0.0, 140);
    }
  }

  /** Optional: replace counts (e.g., when switching models) */
  setCounts(like: number, heart: number) {
    this.likeCount = Math.max(0, Math.floor(like));
    this.heartCount = Math.max(0, Math.floor(heart));
    this.redraw();
  }

  /** Read current counts */
  getCounts() {
    return { like: this.likeCount, heart: this.heartCount };
  }

  /** Increment and spawn particle */
  bump(kind: ReactionKind) {
    if (kind === 'like') this.likeCount++;
    else this.heartCount++;
    this.redraw();
    this.spawnChip(kind);
    this.show(); // refresh auto-hide timer
  }

  /** Call each frame */
  tick(dt: number) {
    const pos = this.getObjectWorldPos?.();
    if (pos) this.anchor.position.copy(pos).add(this.OFFSET);
    this.anchor.quaternion.copy(this.camera.quaternion);

    if (this.visible && performance.now() >= this.hideAt) this.hide();

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.sprite.parent?.remove(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.ttl / 0.6);
    }
  }

  // ---- drawing & fx ----
  private redraw() {
    const c = this.panelCanvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    // bg
    this.roundedRect(ctx, 0, 0, c.width, c.height, 24);
    ctx.fillStyle = 'rgba(18,18,28,0.82)';
    ctx.fill();

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.globalAlpha = 0.95;
    ctx.fillText('Reactions', 22, 44);
    ctx.globalAlpha = 1;

    // Counts
    ctx.font = '600 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(`👍  ${this.likeCount}`, 22, 86);
    ctx.fillText(`❤️  ${this.heartCount}`, 160, 86);

    // Divider
    ctx.globalAlpha = 0.22;
    ctx.fillRect(18, 102, c.width - 36, 2);
    ctx.globalAlpha = 1;

    // Comments
    ctx.fillStyle = '#fff';
    ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Comments', 22, 132);

    ctx.font = '400 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.globalAlpha = 0.95;
    this.wrapText(ctx, 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam eget hendrerit metus.',
      22, 160, c.width - 44, 22);
    this.wrapText(ctx, 'Integer faucibus magna non tincidunt mattis, purus lorem gravida augue, nec viverra nibh enim eget velit.',
      22, 206, c.width - 44, 22);
    ctx.globalAlpha = 1;

    this.panelTex.needsUpdate = true;
  }

  private spawnChip(kind: ReactionKind) {
    const canv = document.createElement('canvas');
    canv.width = 256; canv.height = 128;
    const cx = canv.getContext('2d')!;
    cx.clearRect(0,0,canv.width, canv.height);

    // rounded bg
    cx.fillStyle = 'rgba(255,255,255,0.25)';
    const r = 32, w = canv.width, h = canv.height;
    cx.beginPath();
    cx.moveTo(r, 0);
    cx.arcTo(w, 0, w, h, r);
    cx.arcTo(w, h, 0, h, r);
    cx.arcTo(0, h, 0, 0, r);
    cx.arcTo(0, 0, w, 0, r);
    cx.closePath();
    cx.fill();

    cx.fillStyle = '#fff';
    cx.font = '700 42px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText(kind === 'like' ? '+1 👍' : '+1 ❤️', w/2, h/2);

    const tex = new THREE.CanvasTexture(canv);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1 });
    const sprite = new THREE.Sprite(mat);

    const chipW = this.PANEL_W * 0.55;
    const aspect = canv.height / canv.width;
    sprite.scale.set(chipW, chipW * aspect, 1);
    sprite.position.set(0, this.PANEL_H * 0.35, 0.002);
    this.anchor.add(sprite);

    this.particles.push({ sprite, vel: new THREE.Vector3(0, 0.25, 0), ttl: 0.8 });
  }

  private roundedRect(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number){
    const rr = Math.min(r, w*0.5, h*0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private wrapText(ctx: CanvasRenderingContext2D, text:string, x:number, y:number, maxWidth:number, lineHeight:number){
    const words = text.split(' ');
    let line = ''; let cursorY = y;
    for (let n=0; n<words.length; n++){
      const testLine = line + words[n] + ' ';
      const w = ctx.measureText(testLine).width;
      if (w > maxWidth && n>0){ ctx.fillText(line, x, cursorY); line = words[n] + ' '; cursorY += lineHeight; }
      else line = testLine;
    }
    ctx.fillText(line, x, cursorY);
  }

  private fadeTo(target:number, ms:number){
    const mat = this.panel.material;
    const start = mat.opacity;
    const t0 = performance.now();
    const step = () => {
      const t = (performance.now() - t0) / ms;
      const k = Math.min(1, Math.max(0, t));
      mat.opacity = start + (target - start) * k;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
