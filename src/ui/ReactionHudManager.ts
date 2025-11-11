// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind } from './ReactionHud';

export class ReactionHudManager {
  private hud: ReactionHud;
  private counts = new Map<string, { like: number; heart: number }>();
  private currentKey: string | null = null;
  private alwaysVisible = true;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
    this.hud.setPersistent(true); // MR window stays up by default
  }

  enableAlwaysVisible(v: boolean) {
    this.alwaysVisible = v;
    this.hud.setPersistent(v);
  }

  showFor(modelKey: string) {
    this.currentKey = modelKey;
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    this.hud.setCounts(c.like, c.heart);
    this.hud.show(!this.alwaysVisible ? true : false); // persistent => no auto-hide
  }

  toggleFor(modelKey: string) {
    if (this.currentKey === modelKey) {
      if (!this.alwaysVisible) this.hud.hide();
      this.currentKey = null;
    } else {
      this.showFor(modelKey);
    }
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

  tick(dt: number) { this.hud.tick(dt); }

  // no-op for backward compatibility
  setAvatars(_userUrl?: string, _commenterUrl?: string) { /* no-op */ }

  setIcons(heartUrl?: string, likeUrl?: string) { this.hud.setIcons(heartUrl, likeUrl); }

  getCounts(modelKey: string) {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0 };
  }
}
