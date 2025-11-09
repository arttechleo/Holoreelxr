// src/ui/ReactionHud.ts
import * as THREE from 'three';

type Kind = 'like' | 'heart';

/**
 * 3D, world-anchored reaction HUD (ALWAYS VISIBLE)
 * - Billboard panel rendered in 3D, facing the camera
 * - Shows stable 👍/❤️ counters and a "Comments" block (lorem ipsum)
 * - On bump(kind), increments counters and spawns a floating "+1" sprite
 *
 * Public API:
 *   tick(dt: number): void
 *   bump(kind: 'like'|'heart'): void
 *   setCounts(like: number, heart: number): void   // optional initializer
 */
export class ReactionHud {
  private anchor = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private panelTex: THREE.CanvasTexture;
  private panelCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private likeCount = 0;
  private heartCount = 0;

  // particles (+1 sprites) that float up & fade
  private particles: Array<{
    sprite: THREE.Sprite;
    vel: THREE.Vector3;
    ttl: number; // seconds
  }> = [];

  // layout / style
  private readonly PANEL_W = 0.28; // meters
  private readonly PANEL_H = 0.20;
  private readonly OFFSET = new THREE.Vector3(0, 0.16, 0); // above model center

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    // ----- panel canvas -----
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 512;
    this.panelCanvas.height = 360;
    const ctx = this.panelCanvas.getContext('2d');
    if (!ctx) throw new Error('ReactionHud: cannot get 2D context');
    this.ctx = ctx;

    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.minFilter = THREE.LinearFilter;
    this.panelTex.magFilter = THREE.LinearFilter;
    this.panelTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.panelTex,
      transparent: true,
      opacity: 1.0,        // ALWAYS visible
      depthTest: true,
      depthWrite: false,
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 999;
    this.anchor.add(this.panel);

    this.scene.add(this.anchor);

    // initial draw
    this.redrawPanel();
  }

  /** Optional: initialize counts from some store */
  setCounts(like: number, heart: number) {
    this.likeCount = Math.max(0, Math.floor(like));
    this.heartCount = Math.max(0, Math.floor(heart));
    this.redrawPanel();
  }

  /** Call each frame with dt (seconds) */
  tick(dt: number) {
    // follow model
    const pos = this.getObjectWorldPos?.();
    if (pos) this.anchor.position.copy(pos).add(this.OFFSET);

    // billboard to camera
    this.anchor.quaternion.copy(this.camera.quaternion);

    // update floating "+1" particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.sprite.parent?.remove(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      p.sprite.position.addScaledVector(p.vel, dt);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.opacity = Math.max(0, p.ttl / 0.6); // fade out over last ~0.6s
    }
  }

  /** Increment count and play +1 particle */
  bump(kind: Kind) {
    if (kind === 'like') this.likeCount++;
    else this.heartCount++;

    this.redrawPanel();
    this.playChip(kind);
  }

  // ---- internal drawing helpers ----

  private roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  private redrawPanel() {
    const c = this.panelCanvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    // bg
    this.roundedRect(ctx, 0, 0, c.width, c.height, 24);
    ctx.fillStyle = 'rgba(18,18,28,0.82)';
    ctx.fill();

    // title
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.globalAlpha = 0.95;
    ctx.fillText('Reactions', 22, 44);
    ctx.globalAlpha = 1;

    // counts row
    ctx.font = '600 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(`👍  ${this.likeCount}`, 22, 86);
    ctx.fillText(`❤️  ${this.heartCount}`, 160, 86);

    // divider
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(18, 102, c.width - 36, 2);
    ctx.globalAlpha = 1;

    // comments
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Comments', 22, 132);

    ctx.font = '400 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.globalAlpha = 0.95;
    this.wrapText(
      ctx,
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam eget hendrerit metus.',
      22, 160, c.width - 44, 22
    );
    this.wrapText(
      ctx,
      'Integer faucibus magna non tincidunt mattis, purus lorem gravida augue, nec viverra nibh enim eget velit.',
      22, 206, c.width - 44, 22
    );
    ctx.globalAlpha = 1;

    this.panelTex.needsUpdate = true;
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ) {
    const words = text.split(' ');
    let line = '';
    let cursorY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, cursorY);
        line = words[n] + ' ';
        cursorY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, cursorY);
  }

  private playChip(kind: Kind) {
    // build a small canvas texture with "+1 👍/❤️"
    const chipCanvas = document.createElement('canvas');
    chipCanvas.width = 256;
    chipCanvas.height = 128;
    const cx = chipCanvas.getContext('2d')!;
    cx.clearRect(0, 0, chipCanvas.width, chipCanvas.height);

    // rounded bg
    cx.fillStyle = 'rgba(255,255,255,0.25)';
    const r = 32, w = chipCanvas.width, h = chipCanvas.height;
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
    cx.fillText(kind === 'like' ? '+1 👍' : '+1 ❤️', w / 2, h / 2);

    const tex = new THREE.CanvasTexture(chipCanvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1 });
    const sprite = new THREE.Sprite(mat);

    // size relative to panel
    const chipW = this.PANEL_W * 0.55;
    const aspect = chipCanvas.height / chipCanvas.width;
    sprite.scale.set(chipW, chipW * aspect, 1);

    // start slightly above panel center
    sprite.position.set(0, this.PANEL_H * 0.35, 0.002);

    this.anchor.add(sprite);

    // upward velocity and TTL
    this.particles.push({
      sprite,
      vel: new THREE.Vector3(0, 0.25, 0), // m/s up
      ttl: 0.8, // seconds
    });
  }
}
