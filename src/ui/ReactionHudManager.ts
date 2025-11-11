// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment, Hit } from './ReactionHud';

export type Counts = { like: number; heart: number; repost: number };

export default class ReactionHudManager {
  private hud: ReactionHud;

  // Per-model state (in-memory)
  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();
  private currentKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
  }

  // Icons
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) { this.hud.setIcons(heartUrl, likeUrl, repostUrl); }

  // Current model binding
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

  // Queries / utils
  getCounts(modelKey: string): Counts { return this.counts.get(modelKey) ?? { like: 0, heart: 0, repost: 0 }; }
  getComments(modelKey: string): Comment[] { return this.comments.get(modelKey) ?? []; }
  getPanelCenterWorld(): THREE.Vector3 { return this.hud.getPanelCenterWorld(); }

  // Picking
  hitTestWorld(worldPoint: THREE.Vector3) { return this.hud.hitTestWorld(worldPoint); }
  raycastHit(ray: THREE.Ray): Hit { return this.hud.raycastHit(ray); }

  // Tick (position follow + particles)
  tick(dt: number) { this.hud.tick(dt); }
}
