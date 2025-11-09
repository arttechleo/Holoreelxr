import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { ThreeXRApp } from '../app/ThreeXRApp';
import { FeedStore } from '../feed/FeedStore';

/**
 * Rotation smoothing:
 * - Uses SmoothDamp (critically damped) for angle.
 * - Lower gain + deadzone + clamp to tame jitter.
 */
export class FeedControls {
  // ===== Scroll (1-hand vertical) =====
  private lastPinchY: number | null = null;
  private filtPinchY: number | null = null;
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private pinchStartAt: number | null = null;

  private readonly SCROLL_MIN_HOLD_MS = 140;
  private readonly SCROLL_DISP = 0.028;
  private readonly SCROLL_COOLDOWN_MS = 330;
  private readonly SCROLL_VEL_MIN = 0.010;
  private readonly SCROLL_IN_AIR_DIST = 0.24;
  private readonly LPF_SCROLL_ALPHA = 0.22;

  // ===== Two-hand transform =====
  private twoHandActive = false;
  private baseDist = 0;
  private baseAngle = 0;
  private baseScale = 1;

  // scale feel
  private readonly SCALE_GAIN = 2.2;
  private LPF_ALPHA = 0.25;
  private SCALE_DEADBAND = 0.01;
  private filtDist = 0;

  // --- ROTATION: SmoothDamp params (buttery smooth) ---
  private rotTarget = 0;                 // desired angle (rad)
  private rotVel = 0;                    // angular velocity (rad/s) used by smoothDamp
  private readonly ROT_GAIN = 0.45;      // mapping from hand angle delta -> object yaw (lower = gentler)
  private readonly ROT_DEADZONE = THREE.MathUtils.degToRad(2.0); // ignore tiny jitter
  private readonly ROT_MAX_DELTA = THREE.MathUtils.degToRad(40); // clamp incoming delta per calc
  private readonly ROT_SMOOTH_TIME = 0.22; // seconds to reach target ~63% (critically damped)
  private readonly ROT_MAX_SPEED = THREE.MathUtils.degToRad(180); // rad/s clamp

  // moving-hand selector
  private LStart = new THREE.Vector3();
  private RStart = new THREE.Vector3();
  private lastL = new THREE.Vector3();
  private lastR = new THREE.Vector3();
  private readonly MOVE_EPS = 0.006;

  // ===== Grab (one hand hold) =====
  private grabbing = false;
  private grabSide: 'left'|'right' | null = null;
  private grabOffset = new THREE.Vector3();
  private grabPending = false;
  private grabPendingSide: 'left'|'right' | null = null;
  private grabPendingStartY: number | null = null;
  private grabTimer: number | null = null;
  private readonly HOLD_MS = 240;
  private readonly PENDING_CANCEL_MOVE = 0.03;

  // ===== Rays =====
  private rayGroup = new THREE.Group();
  private leftRay?: THREE.Line;  private rightRay?: THREE.Line;
  private rayMat = new THREE.LineDashedMaterial({
    color: 0xffffff, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9, depthTest: false
  });

  // ===== Reactions =====
  private lastLikeAt = 0;
  private lastHeartAt = 0;
  private readonly REACT_COOLDOWN_MS = 800;

  constructor(private app: ThreeXRApp, private hands: HandEngine, private store: FeedStore) {
    this.app.scene.add(this.rayGroup);
    this.initRay('left'); this.initRay('right');
    this.setRayVisible('left', false); this.setRayVisible('right', false);

    this.hands.on('leftpinchstart',  () => this.onPinchStart('left'));
    this.hands.on('rightpinchstart', () => this.onPinchStart('right'));
    this.hands.on('leftpinchend',    () => this.onPinchEnd('left'));
    this.hands.on('rightpinchend',   () => this.onPinchEnd('right'));

    this.hands.on('thumbsupstart', (d:any) => {
      const now = performance.now();
      if (now - this.lastLikeAt < this.REACT_COOLDOWN_MS) return;
      this.lastLikeAt = now;

      const side: 'left'|'right' = d?.side === 'left' ? 'left' : 'right';
      const start = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      this.store.likeCurrent(start ?? undefined, side);
    });

    // Heart disabled if both hands pinching (transform mode)
    this.hands.on('heartstart', () => {
      if (this.twoHandActive || (this.hands.state.left.pinch && this.hands.state.right.pinch)) return;
      const now = performance.now();
      if (now - this.lastHeartAt < this.REACT_COOLDOWN_MS) return;
      this.lastHeartAt = now;
      const L = this.hands.pinchMid('left')  ?? this.hands.indexTip('left');
      const R = this.hands.pinchMid('right') ?? this.hands.indexTip('right');
      if (L) this.store.saveCurrent(L.clone());
      if (R) this.store.saveCurrent(R.clone());
    });

    // frame loop
    let last = performance.now();
    this.app.onFrame(() => {
      const now = performance.now();
      const dt = Math.max(0, (now - last) / 1000);
      last = now;

      this.updateAutoAcquirePending();
      this.updateScroll(now);
      this.updateTwoHandTransform(dt);  // <- rotation smoothed here
      this.updateGrabDrag();
      this.updateGrabPendingGuard();
      this.updateRays();

      this.store.tick(dt);
    });
  }

  // ---------- Rays ----------
  private initRay(side:'left'|'right'){
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geom, this.rayMat);
    (line as any).computeLineDistances?.();
    if (side==='left'){ this.leftRay = line; } else { this.rightRay = line; }
    this.rayGroup.add(line);
  }
  private setRayVisible(side:'left'|'right', v:boolean){
    const L = side==='left' ? this.leftRay : this.rightRay;
    if (L) L.visible = v;
  }
  private updateRays(){
    const objPos = this.store.getObjectWorldPos();
    const fallbackDir = new THREE.Vector3(0,0,-1);
    const update = (side:'left'|'right', line?:THREE.Line) => {
      if (!line) return;
      const pinching = this.hands.state[side].pinch;
      const show = pinching || (this.grabbing && this.grabSide === side);
      if (!show){ line.visible = false; return; }

      const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      if (!from){ line.visible = false; return; }

      const to = objPos ? objPos : from.clone().add(fallbackDir.multiplyScalar(0.6));
      const pos = (line.geometry as THREE.BufferGeometry).getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x,   to.y,   to.z);
      pos.needsUpdate = true;
      (line as any).computeLineDistances?.();
      line.visible = true;
    };
    update('left', this.leftRay);
    update('right', this.rightRay);
  }

  // ---------- Pinch lifecycle ----------
  private onPinchStart(side:'left'|'right'){
    this.setRayVisible(side, true);

    this.pinchStartAt = performance.now();
    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y != null) {
      this.lastPinchY = y;
      this.filtPinchY = y;
      this.scrollAccum = 0;
    }

    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) this.cancelGrabPending(); else this.tryStartGrabPending(side);
  }
  private onPinchEnd(side:'left'|'right'){
    this.setRayVisible(side, false);
    this.lastPinchY = null; this.filtPinchY = null; this.scrollAccum = 0; this.pinchStartAt = null;
    if (this.grabPending && this.grabPendingSide === side) this.cancelGrabPending();
    if (this.grabbing && this.grabSide === side) { this.grabbing = false; this.grabSide = null; this.store.notify('Placed'); }
  }

  // ---------- Scroll (ONE hand, vertical, deliberate) ----------
  private updateScroll(now:number){
    if (now < this.scrollCooldownUntil) return;
    if (this.grabPending || this.grabbing) return;

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if ((lp && rp) || (!lp && !rp)) return;     // exactly one hand
    const side: 'left'|'right' = lp ? 'left' : 'right';

    if (this.pinchStartAt && (now - this.pinchStartAt) < this.SCROLL_MIN_HOLD_MS) return;

    const mid = this.hands.pinchMid(side);
    if (mid){
      const distSurf = this.distanceToObjectSurface(mid);
      if (distSurf != null && distSurf < this.SCROLL_IN_AIR_DIST) return; // near object → don't scroll
    }

    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y == null) return;

    if (this.filtPinchY == null) this.filtPinchY = y;
    this.filtPinchY = this.filtPinchY + (y - this.filtPinchY) * this.LPF_SCROLL_ALPHA;

    if (this.lastPinchY == null) { this.lastPinchY = this.filtPinchY; return; }

    const dy = this.filtPinchY - this.lastPinchY;
    this.lastPinchY = this.filtPinchY;

    if (Math.abs(dy) < this.SCROLL_VEL_MIN) return;

    this.scrollAccum += dy;

    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP){
      const dir = this.scrollAccum < 0 ? +1 : -1;
      this.store.next(dir);
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
    }
  }

  // ---------- Two-hand transform (SCALED + SMOOTH ROTATION) ----------
  private updateTwoHandTransform(dt:number){
    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if (this.grabPending || this.grabbing) return;
    if (!(lp && rp)) { this.twoHandActive = false; return; }

    const Lt = this.hands.thumbTip('left');
    const Rt = this.hands.thumbTip('right');
    if (!(Lt && Rt)) { this.twoHandActive = false; return; }

    this.lastL.copy(Lt); this.lastR.copy(Rt);

    const rawDist  = Lt.distanceTo(Rt);
    if (!this.twoHandActive){
      this.twoHandActive = true;
      this.baseDist  = rawDist;
      this.baseScale = this.store.scale;
      this.filtDist  = rawDist;

      // initialize rotation target with current rotation to avoid jumps
      this.rotTarget = this.store.rotationY;

      // reset movement baselines
      this.LStart.copy(Lt);
      this.RStart.copy(Rt);
      return;
    }

    // ---- Scale ----
    this.filtDist = this.filtDist + (rawDist - this.filtDist) * this.LPF_ALPHA;
    const ratio = Math.max(0.01, this.filtDist / this.baseDist);
    const scaleRaw = this.baseScale * Math.pow(ratio, this.SCALE_GAIN);
    const scaleDelta = Math.abs(scaleRaw - this.store.scale);
    const targetScale = scaleDelta > this.SCALE_DEADBAND ? scaleRaw : this.store.scale;
    this.store.setTargetTransform(targetScale, this.store.rotationY);

    // ---- Rotation (continuous + smoothed) ----
    const lMove = this.lastL.distanceTo(this.LStart);
    const rMove = this.lastR.distanceTo(this.RStart);
    if (lMove + rMove < this.MOVE_EPS * 2) {
      // still apply smoothing toward target, but don't update target if hands barely moved
      const smooth = this.smoothDampAngle(
        this.store.rotationY, this.rotTarget, (v)=> this.rotVel = v, this.rotVel,
        this.ROT_SMOOTH_TIME, this.ROT_MAX_SPEED, dt
      );
      this.store.setTargetTransform(this.store.scale, smooth);
      return;
    }

    const stationary = (lMove <= rMove) ? this.lastL : this.lastR;
    const moving     = (lMove <= rMove) ? this.lastR : this.lastL;

    // angle in screen/XY space around stationary hand
    let dA = Math.atan2(moving.y - stationary.y, moving.x - stationary.x)
           - Math.atan2(this.RStart.y - this.LStart.y, this.RStart.x - this.LStart.x);

    // normalize to [-PI, PI]
    while (dA >  Math.PI) dA -= 2*Math.PI;
    while (dA < -Math.PI) dA += 2*Math.PI;

    if (Math.abs(dA) < this.ROT_DEADZONE) {
      // small jitter: just smooth toward current target
      const smooth = this.smoothDampAngle(
        this.store.rotationY, this.rotTarget, (v)=> this.rotVel = v, this.rotVel,
        this.ROT_SMOOTH_TIME, this.ROT_MAX_SPEED, dt
      );
      this.store.setTargetTransform(this.store.scale, smooth);
      return;
    }

    // clamp the raw delta to avoid jumps, then map by gain
    dA = THREE.MathUtils.clamp(dA, -this.ROT_MAX_DELTA, this.ROT_MAX_DELTA);
    const desired = this.store.rotationY - dA * this.ROT_GAIN; // minus keeps direction intuitive

    this.rotTarget = desired;

    // SmoothDamp toward target
    const smoothed = this.smoothDampAngle(
      this.store.rotationY, this.rotTarget, (v)=> this.rotVel = v, this.rotVel,
      this.ROT_SMOOTH_TIME, this.ROT_MAX_SPEED, dt
    );

    this.store.setTargetTransform(this.store.scale, smoothed);
  }

  // ---------- SmoothDamp for angles (critically-damped spring) ----------
  // Adapted from Unity's SmoothDamp with angle wrapping
  private smoothDampAngle(
    current:number,
    target:number,
    setVel:(v:number)=>void,
    currentVel:number,
    smoothTime:number,
    maxSpeed:number,
    deltaTime:number
  ){
    // wrap difference to [-PI, PI]
    let delta = target - current;
    while (delta >  Math.PI) delta -= 2*Math.PI;
    while (delta < -Math.PI) delta += 2*Math.PI;

    target = current + delta;
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    let change = current - target;
    const originalTo = target;

    // clamp max speed
    const maxChange = maxSpeed * smoothTime;
    change = THREE.MathUtils.clamp(change, -maxChange, maxChange);
    target = current - change;

    const temp = (currentVel + omega * (target - current)) * deltaTime;
    const newVel = (currentVel - omega * temp) * exp;
    let output = target + (change + temp) * exp;

    // prevent overshoot
    const origDelta = originalTo - current;
    const outDelta = output - originalTo;
    if (origDelta * outDelta > 0) {
      output = originalTo;
      setVel(0);
      return output;
    }

    setVel(newVel);
    return output;
  }

  // ---------- Grab ----------
  private updateAutoAcquirePending(){
    if (this.grabPending || this.grabbing) return;
    const lp = this.hands.state.left.pinch, rp = this.hands.state.right.pinch;
    if (lp === rp) return; // 0 or 2
    const side: 'left'|'right' = lp ? 'left' : 'right';
    const other = lp ? 'right' : 'left';
    if (this.hands.state[other].pinch) return;

    const pinch = this.hands.pinchMid(side);
    if (!pinch) return;

    const distSurf = this.distanceToObjectSurface(pinch);
    if (distSurf != null && distSurf <= 0.18) {
      this.tryStartGrabPending(side);
    }
  }
  private tryStartGrabPending(side:'left'|'right'){
    if (this.grabbing || this.grabPending) return;
    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) return;
    const pinch = this.hands.pinchMid(side); if (!pinch) return;

    const distSurf = this.distanceToObjectSurface(pinch);
    if (distSurf == null || distSurf > 0.18) return;

    this.grabPending = true;
    this.grabPendingSide = side;
    this.grabPendingStartY = this.hands.pinchMid(side)?.y ?? null;
    if (this.grabTimer != null) clearTimeout(this.grabTimer);

    this.grabTimer = window.setTimeout(() => {
      if (!this.grabPending || this.grabPendingSide !== side) return;
      const other = side === 'left' ? 'right' : 'left';
      const stillPinching = this.hands.state[side].pinch && !this.hands.state[other].pinch;
      const mid = this.hands.pinchMid(side);
      const objPosNow = this.store.getObjectWorldPos();
      if (!stillPinching || !mid || !objPosNow) { this.cancelGrabPending(); return; }

      this.grabOffset.copy(objPosNow).sub(mid);
      this.grabPending = false; this.grabPendingSide = null; this.grabPendingStartY = null;
      this.grabbing = true; this.grabSide = side;
      this.store.notify('Grabbed – move your hand to place');
    }, this.HOLD_MS);
  }
  private cancelGrabPending(){
    this.grabPending = false; this.grabPendingSide = null; this.grabPendingStartY = null;
    if (this.grabTimer != null) { clearTimeout(this.grabTimer); this.grabTimer = null; }
  }
  private updateGrabPendingGuard(){
    if (!this.grabPending || !this.grabPendingSide) return;
    const yNow = this.hands.pinchMid(this.grabPendingSide)?.y ?? null;
    if (yNow != null && this.grabPendingStartY != null) {
      if (Math.abs(yNow - this.grabPendingStartY) > this.PENDING_CANCEL_MOVE) { this.cancelGrabPending(); return; }
    }
    const other = this.grabPendingSide === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) this.cancelGrabPending();
  }
  private updateGrabDrag(){
    if (!this.grabbing || !this.grabSide) return;
    const other = this.grabSide === 'left' ? 'right' : 'left';
    if (this.hands.state[this.grabSide].pinch && this.hands.state[other].pinch){
      this.grabbing = false; this.grabSide = null; this.store.notify('Grab canceled (two-hand mode)'); return;
    }
    if (!this.hands.state[this.grabSide].pinch){
      this.grabbing = false; this.grabSide = null; this.store.notify('Placed'); return;
    }
    const mid = this.hands.pinchMid(this.grabSide); if (!mid) return;
    const target = mid.clone().add(this.grabOffset);
    this.store.setPosition(target);
  }

  // ---------- Helpers ----------
  private distanceToObjectSurface(worldPoint: THREE.Vector3): number | null {
    const info = this.store.getObjectBounds(); if (!info) return null;
    const { center, radius } = info;
    const distCenter = worldPoint.distanceTo(center);
    return Math.max(0, distCenter - (radius + 0.04));
  }
}
