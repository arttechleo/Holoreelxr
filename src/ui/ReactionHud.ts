// src/ui/ReactionHud.ts
import * as THREE from 'three';

export type ReactionKind = 'like' | 'heart';

export class ReactionHud {
  private anchor = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private panelTex: THREE.CanvasTexture;
  private panelCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // display-only values; manager owns the true counts
  private likeCount = 0;
  private heartCount = 0;

  private particles: Array<{ sprite: THREE.Sprite; vel: THREE.Vector3; ttl: number }> = [];

  private visible = false;
  private hideAt = 0;
  private readonly AUTO_HIDE_MS = 2000;

  // layout
  private readonly PANEL_W = 0.46;   // made a bit wider to fit prototype
  private readonly PANEL_H = 0.26;
  private readonly OFFSET = new THREE.Vector3(0, 0.18, 0);

  // avatar placeholders
  private userAvatar?: HTMLImageElement;
  private commenterAvatar?: HTMLImageElement;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 1024;  // higher res for crisp text
    this.panelCanvas.height = 576;
    const ctx = this.panelCanvas.getContext('2d');
    if (!ctx) throw new Error('ReactionHud: cannot get 2D context');
    this.ctx = ctx;

    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.minFilter = THREE.LinearFilter;
    this.panelTex.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.panelTex, transparent: true, opacity: 0.0, depthTest: true, depthWrite: false
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 999;
    this.anchor.add(this.panel);
    this.scene.add(this.anchor);

    this.redraw();
  }

  /** No math here — just copy counts and rerender */
  setCounts(like: number, heart: number) {
    this.likeCount = Math.max(0, Math.floor(like));
    this.heartCount = Math.max(0, Math.floor(heart));
    this.redraw();
  }

  /** Optional avatars (URLs); call any time before/after show */
  setAvatars(userUrl?: string, commenterUrl?: string) {
    const load = (url?: string) => {
      if (!url) return undefined;
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; return img;
    };
    this.userAvatar = load(userUrl);
    this.commenterAvatar = load(commenterUrl);
    // re-render once they load
    const onload = () => this.redraw();
    if (this.userAvatar) this.userAvatar.onload = onload;
    if (this.commenterAvatar) this.commenterAvatar.onload = onload;
  }

  /** Visual chip only; manager has already updated numbers */
  flash(kind: ReactionKind) {
    this.spawnChip(kind);
    this.show(); // ensure visible when flashing
  }

  show(autoHide = true) {
    if (!this.visible) { this.visible = true; this.fadeTo(1.0, 140); }
    if (autoHide) this.hideAt = performance.now() + this.AUTO_HIDE_MS;
  }
  hide() { if (this.visible) { this.visible = false; this.fadeTo(0.0, 140); } }

  tick(dt: number) {
    const pos = this.getObjectWorldPos?.();
    if (pos) this.anchor.position.copy(pos).add(this.OFFSET);
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

    // card bg
    this.rounded(ctx, 0, 0, c.width, c.height, 36);
    ctx.fillStyle = 'rgba(18,18,28,0.85)'; ctx.fill();

    // --- Left column (profile + reactions) ---
    const pad = 32;
    const leftW = Math.floor(c.width * 0.38);
    const leftX = pad;
    const centerY = c.height * 0.52;

    // user avatar circle
    const avatarR = 60;
    ctx.save();
    ctx.beginPath();
    ctx.arc(leftX + avatarR, centerY - 110, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (this.userAvatar && this.userAvatar.complete) {
      ctx.drawImage(this.userAvatar, leftX, centerY - 110 - avatarR, avatarR * 2, avatarR * 2);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(leftX, centerY - 110 - avatarR, avatarR * 2, avatarR * 2);
    }
    ctx.restore();
    // circle stroke
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(leftX + avatarR, centerY - 110, avatarR, 0, Math.PI * 2); ctx.stroke();

    // hearts row
    ctx.font = '700 54px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.fillStyle = '#FF476F';
    ctx.fillText('❤️', leftX, centerY + 10);
    ctx.fillStyle = '#fff';
    ctx.font = '700 36px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.fillText(String(this.heartCount), leftX + 84, centerY + 10);

    // likes row
    ctx.font = '700 54px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.fillStyle = '#FFC04D';
    ctx.fillText('👍', leftX, centerY + 90);
    ctx.fillStyle = '#fff';
    ctx.font = '700 36px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.fillText(String(this.likeCount), leftX + 84, centerY + 90);

    // --- Right column (comments) ---
    const rightX = leftW + pad;
    const rightW = c.width - rightX - pad;

    // header with tiny avatar on right
    ctx.fillStyle = '#fff';
    ctx.font = '700 28px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    ctx.fillText('Comments', rightX, pad + 24);
    // tiny avatar circle
    const tinyR = 18;
    const tinyCx = rightX + 160;
    const tinyCy = pad + 16;
    ctx.save();
    ctx.beginPath(); ctx.arc(tinyCx, tinyCy, tinyR, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (this.commenterAvatar && this.commenterAvatar.complete) {
      ctx.drawImage(this.commenterAvatar, tinyCx - tinyR, tinyCy - tinyR, tinyR * 2, tinyR * 2);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(tinyCx - tinyR, tinyCy - tinyR, tinyR * 2, tinyR * 2);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tinyCx, tinyCy, tinyR, 0, Math.PI * 2); ctx.stroke();

    // comment box
    const boxY = pad + 44;
    const boxH = c.height - boxY - pad;
    this.rounded(ctx, rightX, boxY, rightW, boxH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();

    // lorem
    ctx.fillStyle = '#EDEDED';
    ctx.font = '400 22px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    const innerPad = 18;
    const textX = rightX + innerPad;
    const textY = boxY + innerPad + 8;
    const textW = rightW - innerPad * 2;
    this.wrap(ctx,
      'It is a long established fact that a reader will be distracted by the readable content when looking at its layout. The point of using Lorem Ipsum is that it has a more-or-less normal distribution of letters, as opposed to using “Content here, content here”.',
      textX, textY, textW, 28);

    this.panelTex.needsUpdate = true;
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
  private wrap(ctx: CanvasRenderingContext2D, text:string, x:number, y:number, maxWidth:number, lh:number){
    const words = text.split(' '); let line=''; let cy=y;
    for (let i=0;i<words.length;i++){
      const test=line+words[i]+' '; const w=ctx.measureText(test).width;
      if (w>maxWidth && i>0){ ctx.fillText(line, x, cy); line=words[i]+' '; cy+=lh; }
      else line=test;
    }
    ctx.fillText(line, x, cy);
  }
  private fadeTo(target:number, ms:number){
    const mat = this.panel.material; const start = mat.opacity; const t0 = performance.now();
    const step=()=>{ const t=(performance.now()-t0)/ms; const k=Math.min(1,Math.max(0,t)); mat.opacity=start+(target-start)*k; if(k<1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
}
