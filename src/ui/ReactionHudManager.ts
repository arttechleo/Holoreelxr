// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment, Hit } from './ReactionHud';

export type Counts = { like: number; heart: number; repost: number };

export default class ReactionHudManager {
  private hud: ReactionHud;

  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();
  private currentKey: string | null = null;

  // XR overlay input
  private overlayEl?: HTMLDivElement;
  private textarea?: HTMLTextAreaElement;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);

    // Hide overlay when XR session ends
    (document as any).addEventListener?.('xrSessionEnd', () => this.closeTextInput());
  }

  // Icons
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) { this.hud.setIcons(heartUrl, likeUrl, repostUrl); }

  // Binding
  getCurrentKey() { return this.currentKey; }
  showFor(modelKey: string) {
    this.currentKey = modelKey;
    const c = this.getCounts(modelKey);
    this.hud.setCounts(c.like, c.heart, c.repost);

    if (!this.comments.has(modelKey) || this.comments.get(modelKey)!.length === 0) {
      const seed: Comment[] = [
        { id: 's1', author: 'Ada', text: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem.' },
        { id: 's2', author: 'Lin', text: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.' },
        { id: 's3', author: 'Sam', text: 'Ut enim ad minima veniam, quis nostrum exercitationem ullam.' },
        { id: 's4', author: 'Mira', text: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse.' }
      ];
      this.comments.set(modelKey, seed);
    }
    this.hud.setComments(this.comments.get(modelKey)!);
  }

  // Reactions
  bump(modelKey: string, kind: ReactionKind) {
    const c = this.getCounts(modelKey);
    if (kind === 'like') c.like += 1;
    else if (kind === 'heart') c.heart += 1;
    else c.repost += 1;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart, c.repost);
      this.hud.flash(kind);
    }
  }

  // Comments
  setComments(modelKey: string, list: Comment[]) {
    this.comments.set(modelKey, list.slice());
    if (this.currentKey === modelKey) this.hud.setComments(list);
  }
  addCommentForCurrent(text: string, author = 'You') {
    if (!this.currentKey) return;
    const list = this.comments.get(this.currentKey) ?? [];
    const c: Comment = { id: `c-${Date.now()}`, author, text };
    list.push(c);
    this.comments.set(this.currentKey, list);
    this.hud.appendComment(c);
  }
  scrollComments(steps: number) { this.hud.scrollComments(steps); }

  // Data access
  getCounts(modelKey: string): Counts { return this.counts.get(modelKey) ?? { like: 0, heart: 0, repost: 0 }; }
  getComments(modelKey: string): Comment[] { return this.comments.get(modelKey) ?? []; }

  // Picking
  hitTestWorld(worldPoint: THREE.Vector3) { return this.hud.projectHitFromPoint(worldPoint); }
  raycastHit(ray: THREE.Ray): Hit { return this.hud.raycastHit(ray); }
  getPanelCenterWorld(): THREE.Vector3 { return this.hud.getPanelCenterWorld(); }

  // Text input (DOM Overlay shown only in XR)
  openTextInput(onSubmit?: (text: string)=>void) {
    // ensure overlay root exists
    if (!this.overlayEl) {
      const el = document.createElement('div');
      el.style.position = 'fixed';
      el.style.left = '0'; el.style.top = '0';
      el.style.width = '100%'; el.style.height = '100%';
      el.style.display = 'grid';
      el.style.placeItems = 'center';
      el.style.background = 'rgba(0,0,0,0.3)';
      el.style.backdropFilter = 'blur(2px)';
      el.style.zIndex = '9999';
      el.style.pointerEvents = 'auto';

      const panel = document.createElement('div');
      panel.style.padding = '12px';
      panel.style.borderRadius = '12px';
      panel.style.background = 'rgba(18,18,28,0.92)';
      panel.style.color = '#fff';
      panel.style.width = 'min(480px, 90vw)';
      panel.style.display = 'grid';
      panel.style.gap = '8px';
      el.appendChild(panel);

      const title = document.createElement('div');
      title.textContent = 'New comment';
      title.style.fontWeight = '700';
      panel.appendChild(title);

      const ta = document.createElement('textarea');
      ta.rows = 4;
      ta.style.width = '100%';
      ta.style.resize = 'none';
      ta.style.font = '16px system-ui';
      ta.placeholder = 'Type your comment…';
      panel.appendChild(ta);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.justifyContent = 'flex-end';
      panel.appendChild(row);

      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.onclick = () => this.closeTextInput();
      const post = document.createElement('button');
      post.textContent = 'Post';
      post.style.background = '#4b83ff';
      post.style.color = '#fff';
      post.style.border = '0';
      post.style.borderRadius = '8px';
      post.style.padding = '8px 14px';
      post.onclick = () => {
        const txt = ta.value.trim();
        if (txt) this.addCommentForCurrent(txt, 'You');
        this.closeTextInput();
        onSubmit?.(txt);
      };
      row.appendChild(cancel); row.appendChild(post);

      document.body.appendChild(el);
      this.overlayEl = el;
      this.textarea = ta;
    }

    this.overlayEl.style.display = 'grid';
    setTimeout(() => this.textarea?.focus(), 0);
  }

  closeTextInput() {
    if (this.overlayEl) this.overlayEl.style.display = 'none';
  }

  // Tick
  tick(dt: number) { this.hud.tick(dt); }
}
