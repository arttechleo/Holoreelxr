// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind } from './ReactionHud';

export class ReactionHudManager {
  private hud: ReactionHud;
  private counts = new Map<string, { like: number; heart: number }>();
  private currentKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
  }

  /** Show the floating window for this model (sets counts and fades in) */
  showFor(modelKey: string) {
    this.currentKey = modelKey;
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    this.hud.setCounts(c.like, c.heart);
    this.hud.show(true);
  }

  /** Optional toggle helper */
  toggleFor(modelKey: string) {
    if (this.currentKey === modelKey) {
      this.hud.hide();
      this.currentKey = null;
    } else {
      this.showFor(modelKey);
    }
  }

  hide() { this.hud.hide(); }

  /** Increment counters and flash a chip when the window is showing this model */
  bump(modelKey: string, kind: ReactionKind) {
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    if (kind === 'like') c.like += 1; else c.heart += 1;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart);
      this.hud.flash(kind);
    }
  }

  tick(dt: number) { this.hud.tick(dt); }

  /**
   * Kept for backward compatibility. Current ReactionHud has no avatar support,
   * so this is a no-op to avoid TS compile errors where callers still invoke it.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setAvatars(_userUrl?: string, _commenterUrl?: string) { /* no-op */ }

  /** Provide icon URLs in /public (e.g., '/assets/ui/heart.png', '/assets/ui/like.png') */
  setIcons(heartUrl?: string, likeUrl?: string) { this.hud.setIcons(heartUrl, likeUrl); }

  getCounts(modelKey: string) {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0 };
  }
}
