// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart' | 'repost';
export type Comment = { id: string; author?: string; text: string };

/** Public hit type (always includes the element kind; point is optional) */
export type HudHit =
  | { kind: 'like' | 'heart' | 'repost'; point?: THREE.Vector3 }
  | { kind: 'post'; point?: THREE.Vector3 }
  | { kind: 'comments'; point?: THREE.Vector3 }
  | { kind: 'compose'; point?: THREE.Vector3 };

/** Internal hit type used by the canvas mapper */
type HitCore =
  | { kind: 'like' | 'heart' | 'repost' }
  | { kind: 'post' }
  | { kind: 'comments' }
  | { kind: 'compose' }
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

  // comments
  private comments: Comment[] = [];
  private scrollY = 0;                 // pixels
  private readonly SCROLL_STEP = 42;

  // compose (in-panel) state
  private composing = false;
  private composeText = '';
  private composeCaretBlink = 0;
  private composeTimer?: number;
  private onComposeSubmit?: (text: string) => void;

  // particles (chips)
  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  // Panel geometry in meters (drawn to canvas)
  readonly PANEL_W = 0.50;
  readonly PANEL_H = 0.30;

  // high-res canvas for crisp text
  private readonly CANVAS_W = 1152;
  private readonly CANVAS_H = 640;

  // Position offset (above model). NO head-orbit, NO rotation/scale linkage.
  private readonly OFFSET = new THREE.Vector3(0, 0.22, 0);

  // icons (optional)
  private heartIcon?: HTMLImageElement;
  private likeIcon?: HTMLImageElement;
  private repostIcon?: HTMLImageElement;

  // cached layout rects (canvas pixel coords)
  private heartRect!: {x:number;y:number;w:number;h:number};
  private likeRect!: {x:number;y:number;w:number;h:number};
  private repostRect!: {x:number;y:number;w:number;h:number};
  private commentsRect!: {x:number;y:number;w:number;h:number};
  private postBtnRect!: {x:number;y:number;w:number;h:number};
  private composeRect!: {x:number;y:number;w:number;h:number};

  // plane hit tolerance along Z (meters)
  private readonly HIT_THICKNESS = 0.08;

  constructor(
    private scene: THREE.Scene,
    _camera: THREE.Camera, // kept for signature compatibility; not used for rotation
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
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
      opacity: 1.0,             // panel transparency is drawn in the canvas
      depthTest: false,
      depthWrite: false
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999;
    this.anchor.add(this.panel);
    this.scene.add(this.anchor);

    // keyboard capture (XR DOM Overlay/hardware keyboard)
    window.addEventListener('keydown', this.onKeyDown, { passive: false });

    this.redraw();
  }

  dispose(){
    window.removeEventListener('keydown', this.onKeyDown as any);
    if (this.composeTimer) clearInterval(this.composeTimer);
  }

  // ---------- public API ----------

  /** Provide icon URLs (heart/like/repost). */
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

  /** Counters */
  setCounts(like: number, heart: number, repost: number) {
    this.likeCount   = Math.max(0, Math.floor(like));
    this.heartCount  = Math.max(0, Math.floor(heart));
    this.repostCount = Math.max(0, Math.floor(repost));
    this.redraw();
  }

  /** Comments (replace full list) */
  setComments(list: Comment[]) {
    this.comments = Array.isArray(list) ? list.slice() : [];
    this.scrollY = 0;
    this.redraw();
  }

  /** Scroll comments (positive = down) */
  scrollComments(steps: number) {
    const maxScroll = Math.max(0, this.contentHeight() - this.commentsViewportH());
    this.scrollY = THREE.MathUtils.clamp(this.scrollY + steps * this.SCROLL_STEP, 0, maxScroll);
    this.redraw();
  }

  /** Append a comment visually (manager should own persistence). */
  appendComment(c: Comment) {
    this.comments.push(c);
    this.redraw();
  }

  /** Quick post: add a canned comment (used by MR "Post" button) */
  postQuickComment(text = 'Posted from MR ✍️') {
    if (this.onComposeSubmit) this.onComposeSubmit(text);
  }

  /** Visual chip for any reaction. */
  flash(kind: ReactionKind) {
    const text = kind === 'like' ? '+1 👍' : kind === 'heart' ? '+1 ❤️' : '+1 🔁';
    this.spawnChip(text);
  }

  /** Follow object position only (NO rotation/scale updates). */
  tick(dt: number) {
    const center = this.getObjectWorldPos?.();
    if (center) this.anchor.position.copy(center).add(this.OFFSET);

    // caret blink
    if (this.composing) this.composeCaretBlink = (this.composeCaretBlink + dt) % 1.0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { p.sprite.parent?.remove(p.sprite); this.particles.splice(i, 1); continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.ttl / 0.6);
    }
  }

  /** Raycast-style hit test. Provide a THREE.Ray in world space. Returns element or null. */
  raycastHit(ray: THREE.Ray, marginPx = 12): HudHit | null {
    // Panel is an XY plane centered at anchor.position with normal +Z.
    const planeZ = this.anchor.position.z;
    const denom = ray.direction.z;
    if (Math.abs(denom) < 1e-5) return null; // nearly parallel

    const t = (planeZ - ray.origin.z) / denom;
    if (t < 0) return null;

    const p = ray.at(t, new THREE.Vector3());
    if (Math.abs(p.z - planeZ) > this.HIT_THICKNESS) return null;

    // Inside quad in meters?
    const localX = p.x - this.anchor.position.x;
    const localY = p.y - this.anchor.position.y;
    if (Math.abs(localX) > this.PANEL_W * 0.5 || Math.abs(localY) > this.PANEL_H * 0.5) return null;

    // Convert to canvas pixel coords
    const u = (localX / this.PANEL_W) + 0.5;
    const v = 0.5 - (localY / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;

    const hitCore = this.uiHitAt(px, py, marginPx);
    if (!hitCore) return null;
    return { ...hitCore, point: p };
  }

  /** Legacy helper: world point projected straight onto panel. */
  projectHitFromPoint(worldPoint: THREE.Vector3, opts?:{maxPlaneDistance?:number;marginPx?:number}): HudHit | null {
    const planeZ = this.anchor.position.z;
    const maxZ = opts?.maxPlaneDistance ?? this.HIT_THICKNESS;
    if (Math.abs(worldPoint.z - planeZ) > maxZ) return null;

    const localX = worldPoint.x - this.anchor.position.x;
    const localY = worldPoint.y - this.anchor.position.y;
    if (Math.abs(localX) > this.PANEL_W * 0.5 || Math.abs(localY) > this.PANEL_H * 0.5) return null;

    const u = (localX / this.PANEL_W) + 0.5;
    const v = 0.5 - (localY / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;

    const hitCore = this.uiHitAt(px, py, opts?.marginPx ?? 12);
    if (!hitCore) return null;
    return { ...hitCore, point: worldPoint.clone() };
  }

  /** Expose panel center (world) */
  getPanelCenterWorld(): THREE.Vector3 {
    return this.anchor.position.clone();
  }

  /** Begin in-panel compose mode; optional prefill. */
  beginCommentEntry(prefill = '') {
    this.composing = true;
    this.composeText = prefill;
    this.composeCaretBlink = 0;
    if (this.composeTimer) clearInterval(this.composeTimer);
    this.composeTimer = window.setInterval(() => this.redraw(), 120);
    this.redraw();
  }
  cancelCommentEntry() {
    this.composing = false;
    if (this.composeTimer) { clearInterval(this.composeTimer); this.composeTimer = undefined; }
    this.redraw();
  }
  isComposing(){ return this.composing; }
  setOnComposeSubmit(fn: (text: string)=>void){ this.onComposeSubmit = fn; }

  // ---------- drawing ----------

  private redraw() {
    const c = this.panelCanvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    // Card background (slight transparency)
    this.rounded(ctx, 0, 0, c.width, c.height, 32);
    ctx.fillStyle = 'rgba(18,18,28,0.82)';
    ctx.fill();

    // Header
    ctx.fillStyle = '#fff';
    ctx.font = '700 34px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Reactions', 36, 62);

    // Icons row
    const iconSize = 112;
    const baseX = 36;
    const gap = 36 + iconSize;
    const tileY = 62 + 32;

    // tiles
    this.heartRect  = this.drawIconWithCounter(this.heartIcon, '❤️', baseX,          tileY, iconSize, this.heartCount);
    this.likeRect   = this.drawIconWithCounter(this.likeIcon,  '👍', baseX + gap,    tileY, iconSize, this.likeCount);
    this.repostRect = this.drawIconWithCounter(this.repostIcon,'🔁', baseX + gap*2,  tileY, iconSize, this.repostCount);

    // Comments box (right side)
    const boxX = baseX + gap * 2 + iconSize + 48;
    const boxY = 36;
    const boxW = c.width - boxX - 36;
    const boxH = c.height - boxY - 36;

    this.commentsRect = { x: boxX + 16, y: boxY + 16, w: boxW - 32, h: boxH - 32 };
    this.rounded(ctx, boxX, boxY, boxW, boxH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    // Comments clipped region
    ctx.save();
    ctx.beginPath();
    // leave 80px at bottom for compose + Post
    ctx.rect(this.commentsRect.x, this.commentsRect.y, this.commentsRect.w, this.commentsRect.h - 84);
    ctx.clip();
    ctx.translate(0, -this.scrollY);

    // Render each comment as its own “bubble”
    let cy = this.commentsRect.y + 8;
    for (const cmt of this.comments) {
      const bubbleW = this.commentsRect.w;
      const linesH = this.measureWrappedHeight(
        cmtText(cmt),
        '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif',
        bubbleW - 24,
        26
      );
      const bubbleH = linesH + 24;

      this.rounded(ctx, this.commentsRect.x, cy, bubbleW, bubbleH, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();

      ctx.fillStyle = '#EDEDED';
      ctx.font = '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
      cy = this.wrap(ctx, cmtText(cmt), this.commentsRect.x + 12, cy + 18, bubbleW - 24, 26) + 8;
    }
    ctx.restore();

    // Compose area (inside comments, bottom-left)
    const composeH = 44;
    const composePad = 12;
    this.composeRect = {
      x: this.commentsRect.x + 8,
      y: this.commentsRect.y + this.commentsRect.h - composeH - 12,
      w: this.commentsRect.w - 8 - 168, // leave room for Post button
      h: composeH
    };
    this.rounded(ctx, this.composeRect.x, this.composeRect.y, this.composeRect.w, this.composeRect.h, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();

    // Compose text + caret
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.composeRect.x + composePad, this.composeRect.y + 6, this.composeRect.w - composePad*2, this.composeRect.h - 12);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.font = '500 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const text = this.composing ? this.composeText : (this.composeText || 'Type a comment…');
    const placeholder = !this.composing && !this.composeText;
    ctx.globalAlpha = placeholder ? 0.7 : 1.0;
    ctx.fillText(text, this.composeRect.x + composePad, this.composeRect.y + composeH/2 + 1);

    // caret blink
    if (this.composing && (this.composeCaretBlink < 0.5)) {
      const preW = ctx.measureText(this.composeText).width;
      const cx = this.composeRect.x + composePad + preW + 2;
      ctx.globalAlpha = 1;
      ctx.fillRect(cx, this.composeRect.y + 8, 2, composeH - 16);
    }
    ctx.restore();

    // "Post" button (bottom-right inside comments area)
    const btnW = 160, btnH = 44;
    this.postBtnRect = {
      x: this.commentsRect.x + this.commentsRect.w - btnW,
      y: this.commentsRect.y + this.commentsRect.h - btnH,
      w: btnW, h: btnH
    };
    this.rounded(ctx, this.postBtnRect.x, this.postBtnRect.y, this.postBtnRect.w, this.postBtnRect.h, 12);
    ctx.fillStyle = '#4b83ff';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Post', this.postBtnRect.x + btnW/2, this.postBtnRect.y + btnH/2 + 2);

    // Simple scrollbar
    const contentH = this.contentHeight();
    const viewH = this.commentsViewportH();
    if (contentH > viewH) {
      const trackX = this.commentsRect.x + this.commentsRect.w - 6;
      const trackY = this.commentsRect.y;
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

    function cmtText(c: Comment) {
      const author = c.author ? `${c.author}: ` : '';
      return author + c.text;
    }
  }

  // ---------- mapping / helpers ----------

  /** Decide which UI rect (if any) a pixel hits. */
  private uiHitAt(px: number, py: number, marginPx = 12): HitCore {
    const expand = (r:{x:number;y:number;w:number;h:number}) =>
      ({x:r.x - marginPx, y:r.y - marginPx, w:r.w + 2*marginPx, h:r.h + 2*marginPx});
    const inRect = (r:{x:number;y:number;w:number;h:number}) =>
      px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

    if (inRect(expand(this.heartRect)))  return { kind: 'heart' };
    if (inRect(expand(this.likeRect)))   return { kind: 'like' };
    if (inRect(expand(this.repostRect))) return { kind: 'repost' };
    if (inRect(expand(this.postBtnRect))) return { kind: 'post' };
    if (inRect(expand(this.composeRect))) return { kind: 'compose' };
    if (inRect(expand(this.commentsRect))) return { kind: 'comments' };
    return null;
  }

  private commentsViewportH(): number {
    // clipped to commentsRect minus bottom area where the Post button sits (≈84px reserved)
    return this.commentsRect.h - 84;
  }

  private contentHeight(): number {
    // recompute layout height similar to redraw (bubbles)
    let total = 8;
    for (const cmt of this.comments) {
      const linesH = this.measureWrappedHeight(
        (cmt.author ? `${cmt.author}: ` : '') + cmt.text,
        '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif',
        this.commentsRect.w - 24,
        26
      );
      const bubbleH = linesH + 24;
      total += bubbleH + 8;
    }
    return total + 8;
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

  // ---------- keyboard handling ----------

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.composing) return;

    // Avoid scrolling page / AR button focus
    e.preventDefault();

    if (e.key === 'Escape') {
      this.cancelCommentEntry();
      return;
    }
    if (e.key === 'Enter') {
      const text = this.composeText.trim();
      if (text.length && this.onComposeSubmit) this.onComposeSubmit(text);
      this.composeText = '';
      this.cancelCommentEntry();
      return;
    }
    if (e.key === 'Backspace') {
      this.composeText = this.composeText.slice(0, -1);
      this.redraw();
      return;
    }
    if (e.key.length === 1) {
      this.composeText += e.key;
      this.redraw();
    }
  };
}
