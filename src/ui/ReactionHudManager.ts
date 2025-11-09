// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind } from './ReactionHud';

/**
 * Keeps per-model Like/Heart counts by a model key.
 * Reuses a single HUD instance that follows the *current* model.
 * On showFor(key), loads that model's counts and shows the HUD near it.
 */
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

  /** Show HUD for a specific model key (follows current model's world pos) */
  showFor(modelKey: string) {
    this.currentKey = modelKey;
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    this.hud.setCounts(c.like, c.heart);
    this.hud.show(true);
  }

  /** Hide the HUD (e.g., after timeout or explicit) */
  hide() { this.hud.hide(); }

  /** Add a reaction for the given key (also updates visible HUD if key is current) */
  bump(modelKey: string, kind: ReactionKind) {
    const c = this.counts.get(modelKey) ?? { like: 0, heart: 0 };
    if (kind === 'like') c.like++; else c.heart++;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart);
      this.hud.bump(kind);
    }
  }

  /** Drive animations and following */
  tick(dt: number) {
    this.hud.tick(dt);
  }

  /** Read stored counts for a model */
  getCounts(modelKey: string) {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0 };
  }
}
