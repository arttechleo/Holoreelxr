// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment, HudHit } from './ReactionHud';

type Counts = { like: number; heart: number; repost: number };

/**
 * Per-model state for counts + comments, single HUD instance following the active model.
 */
export class ReactionHudManager {
  private hud: ReactionHud;

  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();
  private currentKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);

    this.hud.setOnComposeSubmit((text) => {
      if (!this.currentKey) return;
      const list = this.comments.get(this.currentKey) ?? [];
      const c: Comment = { id: `c-${Date.now()}`, author: 'You', text };
      list.push(c);
      this.comments.set(this.currentKey, list);
      this.hud.appendComment(c);
    });
  }

  // data
  getCounts(modelKey: string): Counts {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0, repost: 0 };
  }
  getComments(modelKey: string): Comment[] {
    return this.comments.get(modelKey) ?? [];
  }

  // icons
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) {
    this.hud.setIcons(heartUrl, likeUrl, repostUrl);
  }

  // comments
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

  // compose
  beginCommentEntry(prefill = '') { this.hud.beginCommentEntry(prefill); }
  cancelCommentEntry() { this.hud.cancelCommentEntry(); }
  isComposing() { return this.hud.isComposing(); }

  // show/bind
  showFor(modelKey: string) {
    this.currentKey = modelKey;

    const c = this.getCounts(modelKey);
    this.hud.setCounts(c.like, c.heart, c.repost);

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

  hide() { /* panel remains visible by design */ }

  // counters
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

  // interaction helpers
  raycastHit(ray: THREE.Ray): HudHit { return this.hud.raycastHit(ray, 14); }
  projectHitFromPoint(p: THREE.Vector3): HudHit { return this.hud.projectHitFromPoint(p); }
  postQuickComment() { this.hud.postQuickComment(); }

  // expose panel center so controls can aim rays
  getPanelCenterWorld(): THREE.Vector3 { return this.hud.getPanelCenterWorld(); }

  // tick
  tick(dt: number) { this.hud.tick(dt); }
}

export default ReactionHudManager;
