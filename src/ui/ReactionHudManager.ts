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

  showFor(modelKey: string) {
    this.currentKey = modelKey;
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    this.hud.setCounts(c.like, c.heart);
    this.hud.show(true);
  }

  hide() { this.hud.hide(); }

  /** Manager updates numbers; HUD only visualizes (flash, not increment). */
  bump(modelKey: string, kind: ReactionKind) {
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    if (kind === 'like') c.like += 1; else c.heart += 1;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart);
      this.hud.flash(kind);    // visual only (no extra +1)
    }
  }

  tick(dt: number) { this.hud.tick(dt); }

  setAvatars(userUrl?: string, commenterUrl?: string) { this.hud.setAvatars(userUrl, commenterUrl); }

  getCounts(modelKey: string) {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0 };
  }
}
