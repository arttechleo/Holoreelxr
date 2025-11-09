// src/gestures/StopPalmGesture.ts
import * as THREE from 'three';
import { HandEngine } from './HandEngine';

type Side = 'left' | 'right';
type Listener = (side: Side) => void;

/**
 * Detects a "STOP PALM" gesture:
 *  - Hand OPEN (not pinching)
 *  - Back-of-palm facing camera (palm normal ~ opposite camera forward)
 *  - Held briefly near the current model
 *
 * Emits: 'stoppalm' with side ('left' | 'right')
 *
 * NOTE: If HandEngine provides palm orientation (e.g. palmNormal(side): Vector3),
 * this detector uses it. Otherwise it approximates from thumb/index/pinky tips if present.
 */
export class StopPalmGesture {
  private listeners: Record<'stoppalm', Listener[]> = { stoppalm: [] };

  // Pose sustain timing
  private readonly HOLD_MS = 120; // must hold the pose this long

  // Orientation threshold (degrees) — palm normal should be within this of -cameraForward
  private readonly ANGLE_DEG = 35;

  // Near-model gate
  private readonly MAX_DIST_TO_MODEL = 0.30; // meters to surface/center

  // Spread gate (avoid false positives when fingers collapsed)
  private readonly MIN_THUMB_INDEX_SPREAD = 0.045; // meters

  // Cooldown after a trigger (avoid spam)
  private readonly COOLDOWN_MS = 800;

  // Internal state
  private poseStartL: number | null = null;
  private poseStartR: number | null = null;
  private lastTriggerAt = 0;

  constructor(
    private hands: HandEngine,
    private camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null,
    /** optional, for robust proximity check */
    private distanceToObjectSurface?: (p: THREE.Vector3) => number | null
  ) {}

  on(event: 'stoppalm', fn: Listener) {
    this.listeners[event].push(fn);
  }

  private emit(side: Side) {
    for (const fn of this.listeners.stoppalm) fn(side);
  }

  /** Call every frame */
  tick() {
    const now = performance.now();
    if (now - this.lastTriggerAt < this.COOLDOWN_MS) {
      // still evaluate to maintain pose timers, but won't emit until cooldown passes
    }

    this.checkSide('left', now);
    this.checkSide('right', now);
  }

  // --- Core per-side check ---
  private checkSide(side: Side, now: number) {
    // Must be open hand (no pinch)
    if (this.hands.state[side].pinch) {
      this.resetPose(side);
      return;
    }

    const center = this.getPalmCenter(side);
    if (!center) {
      this.resetPose(side);
      return;
    }

    // Proximity to model
    if (!this.isNearModel(center)) {
      this.resetPose(side);
      return;
    }

    // Finger spread gate (avoid flat knuckles/partial-fist false positives)
    const spreadOK = this.hasSpread(side);
    if (!spreadOK) {
      this.resetPose(side);
      return;
    }

    // Orientation gate (back-of-palm facing camera)
    const facingOK = this.isBackOfPalmFacingCamera(side);
    if (!facingOK) {
      this.resetPose(side);
      return;
    }

    // Passed all gates — sustain timer
    let startRef = side === 'left' ? this.poseStartL : this.poseStartR;
    if (startRef == null) {
      startRef = now;
      if (side === 'left') this.poseStartL = startRef;
      else this.poseStartR = startRef;
    }

    if (now - startRef >= this.HOLD_MS) {
      if (now - this.lastTriggerAt >= this.COOLDOWN_MS) {
        this.lastTriggerAt = now;
        this.emit(side);
      }
      // keep timer running; require cooldown for next trigger
    }
  }

  private resetPose(side: Side) {
    if (side === 'left') this.poseStartL = null;
    else this.poseStartR = null;
  }

  // --- Helpers ---

  /** Try to get a stable palm center (pinchMid is usually stable enough). */
  private getPalmCenter(side: Side): THREE.Vector3 | null {
    const anyHands = this.hands as any;
    // Prefer a direct palm center if HandEngine exposes one
    const fromAPI: THREE.Vector3 | null | undefined = anyHands.palmCenter?.(side);
    if (fromAPI && fromAPI.isVector3) return fromAPI as THREE.Vector3;

    // Else use pinch mid as a stable proxy (or index tip fallback)
    return this.hands.pinchMid(side) ?? this.hands.indexTip(side) ?? this.hands.thumbTip(side) ?? null;
  }

  /** Check if palm is near the current model */
  private isNearModel(point: THREE.Vector3): boolean {
    if (this.distanceToObjectSurface) {
      const dSurf = this.distanceToObjectSurface(point);
      if (dSurf != null) return dSurf <= this.MAX_DIST_TO_MODEL;
    }
    const center = this.getObjectWorldPos();
    if (!center) return false;
    const d = point.distanceTo(center);
    return d <= this.MAX_DIST_TO_MODEL + 0.08; // small cushion
  }

  /** Ensure fingers are reasonably spread (open hand) */
  private hasSpread(side: Side): boolean {
    const thumb = this.hands.thumbTip(side);
    const index = this.hands.indexTip(side);
    if (thumb && index) {
      return thumb.distanceTo(index) >= this.MIN_THUMB_INDEX_SPREAD;
    }
    // If we can’t measure, assume OK but prefer openness check from HandEngine if available
    const anyHands = this.hands as any;
    if (typeof anyHands.isOpen === 'function') {
      try { return !!anyHands.isOpen(side); } catch {}
    }
    return true;
  }

  /**
   * Back-of-palm facing camera?
   * Uses HandEngine.palmNormal(side) if available.
   * If not, estimates the palm normal from (thumb->index) x (index->pinky) when tips exist.
   * As a last resort, falls back to a conservative check that disables orientation gating.
   */
  private isBackOfPalmFacingCamera(side: Side): boolean {
    const camFwd = new THREE.Vector3();
    this.camera.getWorldDirection(camFwd); // unit vector pointing OUT of camera

    let palmNormal: THREE.Vector3 | null = null;

    // 1) Preferred: explicit palm normal from HandEngine
    const anyHands = this.hands as any;
    if (typeof anyHands.palmNormal === 'function') {
      try {
        const n = anyHands.palmNormal(side);
        if (n && n.isVector3) palmNormal = (n as THREE.Vector3).clone().normalize();
      } catch {}
    }

    // 2) Fallback: estimate from finger triangle (thumb, index, pinky)
    if (!palmNormal) {
      const thumb = this.hands.thumbTip(side);
      const index = this.hands.indexTip(side);
      const pinky: THREE.Vector3 | null = (anyHands.pinkyTip?.(side) ?? null);
      if (thumb && index && pinky) {
        const v1 = new THREE.Vector3().subVectors(index, thumb);
        const v2 = new THREE.Vector3().subVectors(pinky, index);
        palmNormal = new THREE.Vector3().crossVectors(v1, v2).normalize();
        // Heuristic: ensure normal direction is outward from palm (flip if needed)
        // We prefer the normal that opposes cam forward when back-of-palm is toward camera.
        if (palmNormal.dot(camFwd) > 0) palmNormal.multiplyScalar(-1);
      }
    }

    if (!palmNormal) {
      // 3) As a last resort, we cannot robustly judge orientation; allow it.
      return true;
    }

    // Back-of-palm facing camera means the PALM (inner) faces away.
    // A common convention: palmNormal points OUT of the palm (front).
    // So we want palmNormal roughly OPPOSITE camera forward.
    const cos = Math.cos(THREE.MathUtils.degToRad(this.ANGLE_DEG));
    const dot = palmNormal.dot(camFwd); // want dot ~ -1
    return dot <= -cos;
  }
}
