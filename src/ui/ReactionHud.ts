// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart';
export type Comment = { id: string; author?: string; text: string };

export class ReactionHud {
  private anchor = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private panelTex: THREE.CanvasTexture;
  private panelCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // counts
  private likeCount = 0;
  private heartCount = 0;

  // comments
  private comments: Comment[] = [];
  private scrollY = 0;         // pixels
  private readonly SCROLL_STEP = 42;  // per "tick" we scroll by this many px

  // particles
  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  private visible = false;
  private hideAt = Infinity; // persistent by default

  // panel size in world units
  private readonly PANEL_W = 0.50;
  private readonly PANEL_H = 0.30;

  // Layout in canvas pixels
  private readonly CANVAS_W = 1024;
  private readonly CANVAS_H = 640;

  // Position offset (just above the model; no orbit and NO head tracking)
  private readonly OFFSET = new THREE.Vector3(0, 0.22, 0);
  private persistent = true;

  // icons (optional)
  private heartIcon?: HTMLImageElement;
  private likeIcon?: HTMLImageElement;

  // (optional) allow orienting with model yaw (set from manager)
  private alignWithYaw = true;
  private currentYaw = 0;

  constructor(
    private scene: THREE.Scene,
    _camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    // canvas used as panel texture
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = this.CANVAS_W;
    this.panelCanvas.height = this.CANVAS_H;
    const ctx = this.panelCanvas.getContext('2d');
    if (!ctx) throw new Error('ReactionHud: cannot get 2D context');
    this.ctx = ctx;

    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.minFilter = THREE.LinearFilter;
    this.panelTex.magFilter = THREE.LinearFilter;

    // plane in 3D (mixed reality)
    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.panelTex,
      transparent: true,
      opacity: 1.0,   // global opacity; we also draw translucent background
      depthTest: false,
      depthWrite: false
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999;
    this.anchor.add(this.panel);
    this.scene.add(this.anchor);

    this.redraw();
  }

  /** Keep MR window around even when no recent interaction */
  setPersistent(enabled: boolean) {
    this.persistent = enabled;
    if (enabled) { this.hideAt = Infinity; this.show(false); }
  }

  /** World-locked: set the UI yaw (e.g., to match the model’s rotationY) */
  setYaw(yRadians: number) { this.currentYaw = yRadians; }

  /** Provide icons */
  setIcons(heartUrl?: string, likeUrl?: string) {
    const load = (url?: string) => {
      if (!url) return undefined;
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; img.onload = () => this.redraw();
      return img;
    };
    this.heartIcon = load(heartUrl);
    this.likeIcon  = load(likeUrl);
  }

  /** Counts */
  setCounts(like: number, heart: number) {
    this.likeCount = Math.max(0, Math.floor(like));
    this.heartCount = Math.max(0, Math.floor(heart));
    this.redraw();
  }

  /** Comments (full replacement) */
  setComments(list: Comment[]) {
    this.comments = Array.isArray(list) ? list.slice() : [];
    this.scrollY = 0; // reset scroll to top
    this.redraw();
  }

  /** Scroll comments by +/- steps (positive = down) */
  scrollComments(steps: number) {
    const maxScroll = Math.max(0, this.contentHeight() - this.commentsViewportH());
    this.scrollY = THREE.MathUtils.clamp(this.scrollY + steps * this.SCROLL_STEP, 0, maxScroll);
    this.redraw();
  }

  show(autoHide = true) {
    if (!this.visible) { this.visible = true; this.fadeTo(1.0, 140); }
    this.hideAt = this.persistent ? Infinity : (performance.now() + 4000);
  }
  hide() {
    if (!this.persistent && this.visible) {
      this.visible = false;
      this.fadeTo(0.0, 140);
    }
  }

  flash(kind: ReactionKind) {
    this.spawnChip(kind === 'like' ? '+1 👍' : '+1 ❤️');
    this.show(!this.persistent);
  }

  flashRepost() {
    this.spawnChip('Reposted 🔁');
    this.show(!this.persistent);
  }

  tick(dt: number) {
    // follow object in MR space (NO billboard; world-locked yaw)
    const center = this.getObjectWorldPos?.();
    if (center) {
      this.anchor.position.copy(center).add(this.OFFSET);
      if (this.alignWithYaw) {
        this.anchor.rotation.set(0, this.currentYaw, 0); // match model yaw only
      }
    }

    if (!this.persistent && this.visible && performance.now() >= this.hideAt) this.hide();

    // chips
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

    // translucent card background
    this.rounded(ctx, 0, 0, c.width, c.height, 36);
    ctx.fillStyle = 'rgba(18,18,28,0.82)';
    ctx.fill();

    // header
    ctx.fillStyle = '#fff';
    ctx.font = '700 34px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Reactions', 36, 62);

    // icons + counters
    const iconSize = 112;
    const heartX = 36 + iconSize / 2;
    const likeX  = heartX + iconSize + 36;
    const rowY   = 62 + 32 + iconSize / 2;

    this.drawIconWithCounter(this.heartIcon, '❤️', heartX, rowY, iconSize, this.heartCount);
    this.drawIconWithCounter(this.likeIcon,  '👍', likeX,  rowY, iconSize, this.likeCount);

    // comments box
    const boxX = likeX + iconSize / 2 + 48;
    const boxY = 36;
    const boxW = c.width - boxX - 36;
    const boxH = c.height - boxY - 36;
    this.rounded(ctx, boxX, boxY, boxW, boxH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    // draw comments with scroll
    ctx.save();
    ctx.beginPath();
    ctx.rect(boxX + 16, boxY + 16, boxW - 32, boxH - 32);
    ctx.clip();

    ctx.translate(0, -this.scrollY);
    let y = boxY + 28;
    const lineH = 26;
    ctx.fillStyle = '#EDEDED';
    ctx.font = '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';

    for (const cmt of this.comments) {
      const author = cmt.author ? `${cmt.author}: ` : '';
      const text = author + cmt.text;
      y = this.wrap(ctx, text, boxX + 24, y, boxW - 48, lineH) + 10;
    }
    ctx.restore();

    // simple scrollbar
    const contentH = this.contentHeight();
    const viewH = this.commentsViewportH();
    if (contentH > viewH) {
      const trackX = boxX + boxW - 8;
      const trackY = boxY + 16;
      const trackH = viewH;
      const thumbH = Math.max(22, (viewH / contentH) * trackH);
      const maxScroll = contentH - viewH;
      const thumbY = trackY + (this.scrollY / maxScroll) * (trackH - thumbH);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(trackX, trackY, 4, trackH);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(trackX-1, thumbY, 6, thumbH);
    }

    this.panelTex.needsUpdate = true;
  }

  private commentsViewportH(): number {
    // inner box height minus paddings (matches drawing above)
    return this.CANVAS_H - 36 - 36 - 32;
  }

  private contentHeight(): number {
    // crude estimate: each line ~ 26px + 10 margin
    const ctx = this.ctx;
    ctx.font = '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    const boxW = this.CANVAS_W - (36 + 112/2 + 36 + 112/2 + 48) - 36; // same as redraw math
    let y = 0;
    for (const cmt of this.comments) {
      const author = cmt.author ? `${cmt.author}: ` : '';
      const text = author + cmt.text;
      y = this.wrap(ctx, text, 0, y, boxW - 48, 26) + 10;
    }
    return y + 32;
  }

  private drawIconWithCounter(img: HTMLImageElement | undefined, fallbackEmoji: string, cx: number, cy: number, size: number, count: number) {
    const ctx = this.ctx;
    const half = size / 2;

    // soft tile
    this.rounded(ctx, cx - half, cy - half, size, size, size * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
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
    ctx.font = '700 36px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(count), cx, cy + half + 50);
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
    const words = text.split(' '); let line=''; let cy=y;
    for (let i=0;i<words.length;i++){
      const test=line+words[i]+' '; const w=ctx.measureText(test).width;
      if (w>maxWidth && i>0){ ctx.fillText(line, x, cy); line=words[i]+' '; cy+=lh; }
      else line=test;
    }
    ctx.fillText(line, x, cy);
    return cy + lh;
  }

  private fadeTo(target:number, ms:number){
    const mat = this.panel.material; const start = mat.opacity; const t0 = performance.now();
    const step=()=>{ const t=(performance.now()-t0)/ms; const k=Math.min(1,Math.max(0,t)); mat.opacity=start+(target-start)*k; if(k<1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
