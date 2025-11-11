// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment } from './ReactionHud';

type Counts = { like: number; heart: number };

export class ReactionHudManager {
  private hud: ReactionHud;

  // keyed by modelKey
  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();

  private currentKey: string | null = null;
  private alwaysVisible = true;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
    this.hud.setPersistent(true);
  }

  enableAlwaysVisible(v: boolean) {
    this.alwaysVisible = v;
    this.hud.setPersistent(v);
  }

  setIcons(heartUrl?: string, likeUrl?: string) { this.hud.setIcons(heartUrl, likeUrl); }

  /** Set yaw so panel is world-locked relative to the model (no head tracking) */
  setYaw(yRadians: number) { this.hud.setYaw(yRadians); }

  /** Provide or update comments for a given model */
  setComments(modelKey: string, list: Comment[]) {
    this.comments.set(modelKey, list.slice());
    if (this.currentKey === modelKey) this.hud.setComments(list);
  }

  /** Scroll comments (positive = down) for current model */
  scrollComments(steps: number) {
    this.hud.scrollComments(steps);
  }

  showFor(modelKey: string) {
    this.currentKey = modelKey;
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    this.hud.setCounts(c.like, c.heart);
    const cmts = this.comments.get(modelKey) ?? [];
    this.hud.setComments(cmts);
    this.hud.show(!this.alwaysVisible ? true : false);
  }

  hide() { if (!this.alwaysVisible) this.hud.hide(); }

  bump(modelKey: string, kind: ReactionKind) {
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    if (kind === 'like') c.like += 1; else c.heart += 1;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart);
      this.hud.flash(kind);
    }
  }

  /** Show repost chip (no counter by design) */
  flashRepost() {
    this.hud.flashRepost();
  }

  tick(dt: number) { this.hud.tick(dt); }

  // Back-compat no-op
  setAvatars(_userUrl?: string, _commenterUrl?: string) { /* no-op */ }

  getCounts(modelKey: string) {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0 };
  }
}
