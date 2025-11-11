// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment } from './ReactionHud';

type Counts = { like: number; heart: number; repost: number };

export class ReactionHudManager {
  private hud: ReactionHud;

  // Per-model state
  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();

  private currentKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
    // Preload with some Lorem Ipsum bubbles for any model we show
  }

  /** Where is per-model data stored?
   *  → In-memory Maps (counts & comments), keyed by your model key (FeedStore.getCurrentKey()).
   *  Persist to backend/localStorage as needed where you integrate data I/O.
   */
  getCounts(modelKey: string): Counts {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0, repost: 0 };
  }

  getComments(modelKey: string): Comment[] {
    return this.comments.get(modelKey) ?? [];
  }

  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) {
    this.hud.setIcons(heartUrl, likeUrl, repostUrl);
  }

  /** Set/replace comments for a model. */
  setComments(modelKey: string, list: Comment[]) {
    this.comments.set(modelKey, list.slice());
    if (this.currentKey === modelKey) this.hud.setComments(list);
  }

  /** Append a comment to current model. */
  addCommentForCurrent(text: string, author = 'You') {
    if (!this.currentKey) return;
    const list = this.comments.get(this.currentKey) ?? [];
    const c: Comment = { id: `c-${Date.now()}`, author, text };
    list.push(c);
    this.comments.set(this.currentKey, list);
    this.hud.appendComment(c);
  }

  /** Scroll current comments. */
  scrollComments(steps: number) {
    this.hud.scrollComments(steps);
  }

  /** Show HUD for a model key, with defaults if empty. */
  showFor(modelKey: string) {
    this.currentKey = modelKey;

    // counters
    const c = this.getCounts(modelKey);
    this.hud.setCounts(c.like, c.heart, c.repost);

    // comments (seed with fun Lorem if empty)
    if (!this.comments.has(modelKey) || this.comments.get(modelKey)!.length === 0) {
      const seed: Comment[] = [
        { id: 's1', author: 'Ada', text: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem.' },
        { id: 's2', author: 'Lin', text: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.' },
        { id: 's3', author: 'Sam', text: 'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit.' },
        { id: 's4', author: 'Mira', text: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.' }
      ];
      this.comments.set(modelKey, seed);
    }
    this.hud.setComments(this.comments.get(modelKey)!);
  }

  hide() { /* panel is always visible by design; keep method for API symmetry */ }

  /** Increment per-model counter and flash chip. */
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

  tick(dt: number) { this.hud.tick(dt); }

  // ---------- DOM Overlay: comment input (shows in MR if dom-overlay is active) ----------
  /**
   * Creates a tiny input at the bottom-left of the page. In a headset that supports
   * WebXR DOM Overlay this appears inside MR; otherwise it falls back to the web page.
   */
  attachCommentOverlay() {
    if (document.getElementById('xr-comment-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'xr-comment-bar';
    Object.assign(bar.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: '1000',
      display: 'flex',
      gap: '8px',
      padding: '8px',
      background: 'rgba(18,18,28,0.82)',
      color: '#fff',
      borderRadius: '10px',
      backdropFilter: 'blur(8px)',
      alignItems: 'center'
    } as CSSStyleDeclaration);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a comment...';
    Object.assign(input.style, {
      width: '260px',
      color: '#fff',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.22)',
      borderRadius: '8px',
      padding: '8px'
    } as CSSStyleDeclaration);

    const btn = document.createElement('button');
    btn.textContent = 'Post';
    Object.assign(btn.style, {
      background: '#4b83ff',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '8px 12px',
      cursor: 'pointer'
    } as CSSStyleDeclaration);

    btn.onclick = () => {
      const text = input.value.trim();
      if (!text) return;
      this.addCommentForCurrent(text);
      input.value = '';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
    });

    bar.appendChild(input);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }
}
