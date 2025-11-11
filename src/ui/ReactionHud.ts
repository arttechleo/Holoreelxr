// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart' | 'repost';
export type Comment = { id: string; author?: string; text: string };

export type Hit =
  | { kind: 'like' | 'heart' | 'repost' }
  | { kind: 'post' }
  | { kind: 'comments' }
  | null;

export class ReactionHud {
  private anchor = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private panelTex: THREE.CanvasTexture;
  private panelCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private likeCount = 0;
  private heartCount = 0;
  private repostCount = 0;

  private comments: Comment[] = [];
  private scrollY = 0;
  private readonly SCROLL_STEP = 42;

  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  readonly PANEL_W = 0.50;
  readonly PANEL_H = 0.30;

  private readonly CANVAS_W = 1152;
  private readonly CANVAS_H = 640;

  // Anchor the panel slightly above the model; position only (no rotation/scale)
  private readonly OFFSET = new THREE.Vector3(0, 0.22, 0);

  private heartIcon?: HTMLImageElement;
  private likeIcon?: HTMLImageElement;
  private repostIcon?: HTMLImageElement;

  // cached canvas rects (px)
  private heartRect!: {x:number;y:number;w:number;h:number};
  private likeRect!: {x:number;y:number;w:number;h:number};
  private repostRect!: {x:number;y:number;w:number;h:number};
  private commentsRect!: {x:number;y:number;w:number;h:number};
  private postBtnRect!: {x:number;y:number;w:number;h:number};

  constructor(
    private scene: THREE.Scene,
    _camera: THREE.Camera,
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
      opacity: 1.0,
      depthTest: false,
      depthWrite: false
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999;
    this.anchor.add(this.panel);
    this.scene.add(this.anchor);

    this.redraw();
  }

  // ---------- external API ----------
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

  setComments(list: Comment[]) {
    this.comments = Array.isArray(list) ? list.slice() : [];
    this.scrollY = 0;
    this.redraw();
  }

  appendComment(c: Comment) { this.comments.push(c); this.redraw(); }
  postQuickComment(text = 'Posted from MR ✍️') { this.appendComment({ id: `c-${Date.now()}`, author: 'You', text }); }

  scrollComments(steps: number) {
    const maxScroll = Math.max(0, this.contentHeight() - this.commentsViewportH());
    this.scrollY = THREE.MathUtils.clamp(this.scrollY + steps * this.SCROLL_STEP, 0, maxScroll);
    this.redraw();
  }

  /** Follow object position only (no rotation/scale updates) */
  tick(dt: number) {
    const center = this.getObjectWorldPos?.();
    if (center) this.anchor.position.copy(center).add(this.OFFSET);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { p.sprite.parent?.remove(p.sprite); this.particles.splice(i, 1); continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      (p.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, p.ttl / 0.6);
    }
  }

  flash(kind: ReactionKind) {
    const text = kind === 'like' ? '+1 👍' : kind === 'heart' ? '+1 ❤️' : '+1 🔁';
    this.spawnChip(text);
  }

  /** Quick world-point hit test (used for “tap near panel center”). */
  hitTestWorld(worldPoint: THREE.Vector3) {
    const inv = new THREE.Matrix4().copy(this.panel.matrixWorld).invert();
    const local = worldPoint.clone().applyMatrix4(inv); // panel local (XY plane)
    if (Math.abs(local.x) > this.PANEL_W * 0.5 || Math.abs(local.y) > this.PANEL_H * 0.5) return null;
    return this.hitCanvas(local);
  }

  /** Full raycast (preferred): intersect a ray with the panel plane, then resolve which widget was hit. */
  raycastHit(ray: THREE.Ray): Hit {
    // Build panel plane from world transform
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.panel.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const pointOnPlane = new THREE.Vector3().setFromMatrixPosition(this.panel.matrixWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pointOnPlane);

    const hit = new THREE.Vector3();
    const ok = ray.intersectPlane(plane, hit);
    if (!ok) return null;

    // Convert world → local to check bounds and map to canvas
    const inv = new THREE.Matrix4().copy(this.panel.matrixWorld).invert();
    const local = hit.applyMatrix4(inv);
    if (Math.abs(local.x) > this.PANEL_W * 0.5 || Math.abs(local.y) > this.PANEL_H * 0.5) return null;

    return this.hitCanvas(local);
  }

  /** For aiming rays */
  getPanelCenterWorld(): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(this.panel.matrixWorld);
  }

  // ---------- internal: map panel-local point → canvas rects ----------
  private hitCanvas(local: THREE.Vector3): Hit {
    const u = (local.x / this.PANEL_W) + 0.5;
    const v = 0.5 - (local.y / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;

    const inRect = (r:{x:number;y:number;w:number;h:number}) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    if (inRect(this.heartRect))  return { kind: 'heart' };
    if (inRect(this.likeRect))   return { kind: 'like' };
    if (inRect(this.repostRect)) return { kind: 'repost' };
    if (inRect(this.postBtnRect)) return { kind: 'post' };
    if (inRect(this.commentsRect)) return { kind: 'comments' };
    return null;
  }

  // ---------- drawing ----------
  private commentsViewportH(): number { return this.commentsRect.h - 64; }
  private contentHeight(): number {
    let total = 8;
    for (const c of this.comments) {
      const text = (c.author ? `${c.author}: ` : '') + c.text;
      const linesH = this.measureWrappedHeight(text,'400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif', this.commentsRect.w - 24, 26);
      total += (linesH + 24) + 8;
    }
    return total + 8;
  }

  private redraw() {
    const c = this.panelCanvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    // bg
    this.rounded(ctx, 0, 0, c.width, c.height, 32);
    ctx.fillStyle = 'rgba(18,18,28,0.82)';
    ctx.fill();

    // header
    ctx.fillStyle = '#fff';
    ctx.font = '700 34px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Reactions', 36, 62);

    // icons row
    const iconSize = 112;
    const baseX = 36;
    const gap = 36 + iconSize;
    const tileY = 62 + 32;
    this.heartRect  = this.drawIconWithCounter(this.heartIcon, '❤️', baseX,          tileY, iconSize, this.heartCount);
    this.likeRect   = this.drawIconWithCounter(this.likeIcon,  '👍', baseX + gap,    tileY, iconSize, this.likeCount);
    this.repostRect = this.drawIconWithCounter(this.repostIcon,'🔁', baseX + gap*2,  tileY, iconSize, this.repostCount);

    // comments box
    const boxX = baseX + gap * 2 + iconSize + 48;
    const boxY = 36;
    const boxW = c.width - boxX - 36;
    const boxH = c.height - boxY - 36;
    this.commentsRect = { x: boxX + 16, y: boxY + 16, w: boxW - 32, h: boxH - 32 };

    this.rounded(ctx, boxX, boxY, boxW, boxH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    // scrollable area
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.commentsRect.x, this.commentsRect.y, this.commentsRect.w, this.commentsRect.h - 64);
    ctx.clip();
    ctx.translate(0, -this.scrollY);

    let cy = this.commentsRect.y + 8;
    for (const cmt of this.comments) {
      const bubbleW = this.commentsRect.w;
      const text = (cmt.author ? `${cmt.author}: ` : '') + cmt.text;

      const linesH = this.measureWrappedHeight(text,'400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif', bubbleW - 24, 26);
      const bubbleH = linesH + 24;

      this.rounded(ctx, this.commentsRect.x, cy, bubbleW, bubbleH, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();

      ctx.fillStyle = '#EDEDED';
      ctx.font = '400 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
      cy = this.wrap(ctx, text, this.commentsRect.x + 12, cy + 18, bubbleW - 24, 26) + 8;
    }
    ctx.restore();

    // Post button
    const btnW = 160, btnH = 44;
    this.postBtnRect = {
      x: this.commentsRect.x + this.commentsRect.w - btnW,
      y: this.commentsRect.y + this.commentsRect.h - btnH,
      w: btnW, h: btnH
    };
    this.rounded(ctx, this.postBtnRect.x, this.postBtnRect.y, this.postBtnRect.w, this.postBtnRect.h, 12);
    ctx.fillStyle = '#4b83ff'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 22px system-ui,-apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Post', this.postBtnRect.x + btnW/2, this.postBtnRect.y + btnH/2 + 2);

    // Scrollbar
    const contentH = this.contentHeight();
    const viewH = this.commentsViewportH();
    if (contentH > viewH) {
      const trackX = this.commentsRect.x + this.commentsRect.w - 6;
      const trackY = this.commentsRect.y;
      const trackH = viewH;
      const thumbH = Math.max(22, (viewH / contentH) * trackH);
      const maxScroll = contentH - viewH;
      const thumbY = trackY + (this.scrollY / maxScroll) * (trackH - thumbH);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(trackX, trackY, 4, trackH);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(trackX-1, thumbY, 6, thumbH);
    }

    this.panelTex.needsUpdate = true;
  }

  private drawIconWithCounter(img: HTMLImageElement | undefined, fallbackEmoji: string, x: number, y: number, size: number, count: number) {
    const ctx = this.ctx;
    this.rounded(ctx, x, y, size, size, size * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();

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
