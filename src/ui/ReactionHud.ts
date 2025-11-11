// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart' | 'repost';
export type Comment = { id: string; author?: string; text: string };

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

  // particles (chips)
  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  private visible = true;              // always visible by default
  private readonly PANEL_W = 0.50;
  private readonly PANEL_H = 0.30;

  // high-res canvas for crisp text
  private readonly CANVAS_W = 1152;
  private readonly CANVAS_H = 640;

  // Position offset (above model). NO orbiting, NO head-tracking rotation, NO scaling linkage.
  private readonly OFFSET = new THREE.Vector3(0, 0.22, 0);

  // icons (optional)
  private heartIcon?: HTMLImageElement;
  private likeIcon?: HTMLImageElement;
  private repostIcon?: HTMLImageElement;

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

    this.redraw();
  }

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

  /** Append a comment to the end. */
  appendComment(c: Comment) {
    this.comments.push(c);
    this.redraw();
  }

  /** Visual chip for any reaction. */
  flash(kind: ReactionKind) {
    const text = kind === 'like' ? '+1 👍' : kind === 'heart' ? '+1 ❤️' : '+1 🔁';
    this.spawnChip(text);
  }

  /** Follow object position only (NO rotation/scale updates). */
  tick(dt: number) {
    const center = this.getObjectWorldPos?.();
    if (center) {
      this.anchor.position.copy(center).add(this.OFFSET);
    }

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
    const baseX = 36 + iconSize / 2;
    const gap = 36 + iconSize;
    const y = 62 + 32 + iconSize / 2;

    this.drawIconWithCounter(this.heartIcon, '❤️', baseX, y, iconSize, this.heartCount);
    this.drawIconWithCounter(this.likeIcon,  '👍', baseX + gap, y, iconSize, this.likeCount);
    this.drawIconWithCounter(this.repostIcon,'🔁', baseX + gap * 2, y, iconSize, this.repostCount);

    // Comments box (right side)
    const boxX = baseX + gap * 2 + iconSize / 2 + 48;
    const boxY = 36;
    const boxW = c.width - boxX - 36;
    const boxH = c.height - boxY - 36;
    this.rounded(ctx, boxX, boxY, boxW, boxH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    // Comments clipped region
    ctx.save();
    ctx.beginPath();
    ctx.rect(boxX + 16, boxY + 16, boxW - 32, boxH - 32);
    ctx.clip();
    ctx.translate(0, -this.scrollY);

    // Render each comment as its own “bubble”
    let cy = boxY + 24;
    for (const cmt of this.comments) {
      const bubbleW = boxW - 48;
      const linesH = this.measureWrappedHeight(
        cmtText(cmt),
        '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif',
        bubbleW - 24,
        26
      );
      const bubbleH = linesH + 24;

      this.rounded(ctx, boxX + 24, cy, bubbleW, bubbleH, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();

      ctx.fillStyle = '#EDEDED';
      ctx.font = '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
      cy = this.wrap(ctx, cmtText(cmt), boxX + 36, cy + 18, bubbleW - 24, 26) + 18 + 8;
    }
    ctx.restore();

    // Simple scrollbar
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

    function cmtText(c: Comment) {
      const author = c.author ? `${c.author}: ` : '';
      return author + c.text;
    }
  }

  private commentsViewportH(): number {
    return this.CANVAS_H - 36 - 36 - 32; // box padding matches redraw
  }

  private contentHeight(): number {
    // recompute layout height similar to redraw (bubbles)
    const boxW = this.CANVAS_W - (36 + (112/2 + 36) * 2 + 112/2 + 48) - 36; // right box W
    let total = 24;
    for (const cmt of this.comments) {
      const bubbleW = boxW - 48;
      const linesH = this.measureWrappedHeight(
        (cmt.author ? `${cmt.author}: ` : '') + cmt.text,
        '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif',
        bubbleW - 24,
        26
      );
      const bubbleH = linesH + 24;
      total += bubbleH + 8;
    }
    total += 24;
    return total;
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
    ctx.font = '700 32px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(count), cx, cy + half + 46);
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
