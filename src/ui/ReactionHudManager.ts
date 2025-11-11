// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment } from './ReactionHud';

export type Counts = { like: number; heart: number; repost: number };

type PersistShape = {
  counts: Record<string, Counts>;
  comments: Record<string, Comment[]>;
};

export class ReactionHudManager {
  private hud: ReactionHud;

  // Per-model state (in-memory)
  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();
  private currentKey: string | null = null;

  // Persistence
  private storageKey: string;
  private onChange?: (modelKey: string, counts: Counts, comments: Comment[]) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null,
    options?: { storageKey?: string; onChange?: (modelKey: string, counts: Counts, comments: Comment[]) => void }
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
    this.storageKey = options?.storageKey ?? 'xr-reactions-v1';
    this.onChange = options?.onChange;

    // Load persisted state
    this.hydrate();
  }

  // ---------- Icons pass-through ----------
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) {
    this.hud.setIcons(heartUrl, likeUrl, repostUrl);
  }

  // ---------- Data access ----------
  getCounts(modelKey: string): Counts {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0, repost: 0 };
  }

  getComments(modelKey: string): Comment[] {
    return this.comments.get(modelKey) ?? [];
  }

  getCurrentKey() { return this.currentKey; }

  // Optional: listen to changes (for analytics or external UI)
  setOnChange(cb?: (modelKey: string, counts: Counts, comments: Comment[]) => void) {
    this.onChange = cb;
  }

  // ---------- Comments ----------
  setComments(modelKey: string, list: Comment[]) {
    const copy = list.slice();
    this.comments.set(modelKey, copy);
    if (this.currentKey === modelKey) this.hud.setComments(copy);
    this.persist();
    this.emitChange(modelKey);
  }

  addCommentForCurrent(text: string, author = 'You') {
    if (!this.currentKey) return;
    const arr = this.comments.get(this.currentKey) ?? [];
    const c: Comment = { id: `c-${Date.now()}`, author, text };
    arr.push(c);
    this.comments.set(this.currentKey, arr);
    this.hud.appendComment(c);
    this.persist();
    this.emitChange(this.currentKey);
  }

  scrollComments(steps: number) {
    this.hud.scrollComments(steps);
  }

  // ---------- Show/bind ----------
  showFor(modelKey: string) {
    this.currentKey = modelKey;

    // Bind counts
    const c = this.getCounts(modelKey);
    this.hud.setCounts(c.like, c.heart, c.repost);

    // Seed comments if none
    if (!this.comments.has(modelKey) || this.comments.get(modelKey)!.length === 0) {
      const seed: Comment[] = [
        { id: 's1', author: 'Ada', text: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem.' },
        { id: 's2', author: 'Lin', text: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.' },
        { id: 's3', author: 'Sam', text: 'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit.' },
        { id: 's4', author: 'Mira', text: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.' }
      ];
      this.comments.set(modelKey, seed);
      this.persist();
      this.emitChange(modelKey);
    }
    this.hud.setComments(this.comments.get(modelKey)!);
  }

  // The UI is always visible by design; hide() no-ops to keep old calls safe
  hide() { /* intentionally empty */ }

  // ---------- Counters ----------
  bump(modelKey: string, kind: ReactionKind) {
    const c = { ...this.getCounts(modelKey) };
    if (kind === 'like') c.like += 1;
    else if (kind === 'heart') c.heart += 1;
    else c.repost += 1;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart, c.repost);
      this.hud.flash(kind);
    }
    this.persist();
    this.emitChange(modelKey);
  }

  // ---------- Hit test / quick actions ----------
  hitTestWorld(worldPoint: THREE.Vector3) {
    return this.hud.hitTestWorld(worldPoint);
  }

  postQuickComment() {
    this.hud.postQuickComment();
    if (!this.currentKey) return;
    const list = this.comments.get(this.currentKey) ?? [];
    list.push({ id: `c-${Date.now()}`, author: 'You', text: 'Posted from MR ✍️' });
    this.comments.set(this.currentKey, list);
    this.persist();
    this.emitChange(this.currentKey);
  }

  // ---------- Tick ----------
  tick(dt: number) {
    this.hud.tick(dt);
  }

  // ---------- Persistence ----------
  private hydrate() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed: PersistShape = JSON.parse(raw);
      if (parsed?.counts) {
        Object.entries(parsed.counts).forEach(([k, v]) => this.counts.set(k, { ...v }));
      }
      if (parsed?.comments) {
        Object.entries(parsed.comments).forEach(([k, v]) => this.comments.set(k, v.slice()));
      }
    } catch {
      // ignore bad data
    }
  }

  private persist() {
    try {
      const obj: PersistShape = {
        counts: {},
        comments: {},
      };
      this.counts.forEach((v, k) => { obj.counts[k] = v; });
      this.comments.forEach((v, k) => { obj.comments[k] = v; });
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }

  private emitChange(modelKey: string) {
    if (!this.onChange) return;
    const counts = this.getCounts(modelKey);
    const comments = this.getComments(modelKey);
    try { this.onChange(modelKey, counts, comments); } catch { /* ignore */ }
  }
}

// Export default too, so both import styles work
export default ReactionHudManager;
