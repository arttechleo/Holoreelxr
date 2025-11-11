// src/controls/FeedControls.ts
import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { ThreeXRApp } from '../app/ThreeXRApp';
import { FeedStore } from '../feed/FeedStore';
import { ReactionHudManager } from '../ui/ReactionHudManager';

export class FeedControls {
  // ===== Scroll (1-hand vertical) =====
  private lastPinchY: number | null = null;
  private filtPinchY: number | null = null;
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private pinchStartAt: number | null = null;

  // scrolling is opt-in only if pinch starts far from model
  private scrollArmed = false;
  private scrollDisarmedThisPinch = false;
  private startDistSurf: number | null = null;
  private startDistCenter: number | null = null;

  private readonly SCROLL_MIN_HOLD_MS = 160;
  private readonly SCROLL_DISP = 0.03;
  private readonly SCROLL_COOLDOWN_MS = 380;
  private readonly SCROLL_VEL_MIN = 0.012;

  private readonly SCROLL_IN_AIR_DIST = 0.28;
  private readonly SCROLL_START_FAR_SURF = 0.40;
  private readonly SCROLL_START_FAR_CENTER = 0.35;

  private readonly LPF_SCROLL_ALPHA = 0.22;

  // ===== Two-hand transform =====
  private twoHandActive = false;
  private baseDist = 0;
  private baseScale = 1;
  private filtDist = 0;
  private readonly LPF_ALPHA = 0.28;
  private readonly SCALE_GAIN = 2.2;
  private readonly SCALE_DEADBAND = 0.004;
  private readonly SCALE_MIN = 0.15;
  private readonly SCALE_MAX = 8;

  // rotation
  private rotTarget = 0;
  private rotVel = 0;
  private readonly ROT_GAIN = 0.9;
  private readonly ROT_DEADZONE = THREE.MathUtils.degToRad(1.0);
  private readonly ROT_MAX_DELTA = THREE.MathUtils.degToRad(60);
  private readonly ROT_SMOOTH_TIME = 0.12;
  private readonly ROT_MAX_SPEED = THREE.MathUtils.degToRad(360);

  // moving-hand selector
  private LStart = new THREE.Vector3();
  private RStart = new THREE.Vector3();
  private lastL = new THREE.Vector3();
  private lastR = new THREE.Vector3();
  private readonly MOVE_EPS = 0.006;

  // ===== Grab =====
  private grabbing = false;
  private grabSide: 'left'|'right' | null = null;
  private grabOffset = new THREE.Vector3();
  private grabPending = false;
  private grabPendingSide: 'left'|'right' | null = null;
  private grabPendingStartY: number | null = null;
  private grabTimer: number | null = null;

  private readonly HOLD_MS = 150;
  private readonly PENDING_CANCEL_MOVE = 0.06;
  private readonly INSTANT_GRAB_DIST = 0.14;

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

  private hudMgr: ReactionHudManager;

  // quick-pinch (still supported, but UI is always on now)
  private tapStartTime: number | null = null;
  private tapStartPos: THREE.Vector3 | null = null;
  private lastTapAt = 0;
  private readonly TAP_MAX_MS = 240;
  private readonly TAP_MOVE_MAX = 0.040;
  private readonly TAP_OBJ_DIST = 0.30;
  private readonly TAP_COOLDOWN_MS = 500;

  constructor(private app: ThreeXRApp, private hands: HandEngine, private store: FeedStore) {
    this.app.scene.add(this.rayGroup);
    this.initRay('left'); this.initRay('right');
    this.setRayVisible('left', false); this.setRayVisible('right', false);

    // HUD: always-on MR window
    this.hudMgr = new ReactionHudManager(
      this.app.scene,
      this.app.camera,
      () => this.store.getObjectWorldPos()
    );
    this.hudMgr.enableAlwaysVisible(true);
    this.hudMgr.setIcons('/assets/ui/heart.png', '/assets/ui/like.png');
    // show immediately for the current model
    this.hudMgr.showFor(this.currentModelKey());

    // Hand lifecycle
    this.hands.on('leftpinchstart',  () => this.onPinchStart('left'));
    this.hands.on('rightpinchstart', () => this.onPinchStart('right'));
    this.hands.on('leftpinchend',    () => this.onPinchEnd('left'));
    this.hands.on('rightpinchend',   () => this.onPinchEnd('right'));

    // L-gesture still allowed (but not required) – it simply refreshes/show
    const onL = () => this.hudMgr.showFor(this.currentModelKey());
    this.hands.on('leftlshapestart',  onL);
    this.hands.on('rightlshapestart', onL);

    // Reactions
    this.hands.on('thumbsupstart', (d:any) => {
      const now = performance.now();
      if (now - this.lastLikeAt < this.REACT_COOLDOWN_MS) return;
      this.lastLikeAt = now;

      const side: 'left'|'right' = d?.side === 'left' ? 'left' : 'right';
      const start = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      this.store.likeCurrent(start ?? undefined, side);
      this.hudMgr.bump(this.currentModelKey(), 'like');
    });

    this.hands.on('heartstart', () => {
      if (this.twoHandActive || (this.hands.state.left.pinch && this.hands.state.right.pinch)) return;
      const now = performance.now();
      if (now - this.lastHeartAt < this.REACT_COOLDOWN_MS) return;
      this.lastHeartAt = now;
      const L = this.hands.pinchMid('left')  ?? this.hands.indexTip('left');
      const R = this.hands.pinchMid('right') ?? this.hands.indexTip('right');
      if (L) this.store.saveCurrent(L.clone());
      if (R) this.store.saveCurrent(R.clone());
      this.hudMgr.bump(this.currentModelKey(), 'heart');
    });

    // frame loop
    let last = performance.now();
    this.app.onFrame(() => {
      const now = performance.now();
      const dt = Math.max(0, (now - last) / 1000);
      last = now;

      this.updateAutoAcquirePending();
      this.updateScroll(now);
      this.updateTwoHandTransform(dt);
      this.updateGrabDrag();
      this.updateGrabPendingGuard();
      this.updateRays();

      // keep MR window following the object
      this.hudMgr.tick(dt);
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

  // ---------- Pinch lifecycle (start gating + instant grab) ----------
  private onPinchStart(side:'left'|'right'){
    this.setRayVisible(side, true);

    this.pinchStartAt = performance.now();
    const mid = this.hands.pinchMid(side);
    const y = mid?.y ?? null;
    if (y != null) {
      this.lastPinchY = y;
      this.filtPinchY = y;
      this.scrollAccum = 0;
    }

    this.scrollDisarmedThisPinch = false;
    this.scrollArmed = false;

    this.tapStartTime = performance.now();
    this.tapStartPos  = mid?.clone() ?? this.hands.thumbTip(side)?.clone() ?? null;

    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) {
      this.twoHandActive = false;
      return;
    }

    const center = this.store.getObjectWorldPos();
    if (center && mid) {
      this.startDistCenter = mid.distanceTo(center);
      const surf = this.distanceToObjectSurface(mid);
      this.startDistSurf = surf == null ? null : surf;
    } else {
      this.startDistCenter = null;
      this.startDistSurf = null;
    }

    if (this.startDistSurf != null && this.startDistSurf <= this.INSTANT_GRAB_DIST) {
      const objPosNow = this.store.getObjectWorldPos();
      if (objPosNow && mid) {
        this.grabbing = true; this.grabSide = side;
        this.grabOffset.copy(objPosNow).sub(mid);
        this.scrollDisarmedThisPinch = true;
        return;
      }
    }

    const farSurf = (this.startDistSurf ?? 1e9) >= this.SCROLL_START_FAR_SURF;
    const farCtr  = (this.startDistCenter ?? 1e9) >= this.SCROLL_START_FAR_CENTER;
    this.scrollArmed = farSurf && farCtr;

    if (!this.scrollArmed) this.tryStartGrabPending(side);
  }

  private onPinchEnd(side:'left'|'right'){
    this.setRayVisible(side, false);

    const now = performance.now();
    const duration = this.tapStartTime ? (now - this.tapStartTime) : Infinity;
    const endPos = this.hands.pinchMid(side)?.clone() ?? this.hands.thumbTip(side)?.clone() ?? null;

    if (this.tapStartPos && endPos && duration <= this.TAP_MAX_MS && (now - this.lastTapAt) >= this.TAP_COOLDOWN_MS) {
      const travel = this.tapStartPos.distanceTo(endPos);
      if (travel <= this.TAP_MOVE_MAX && this.isNearModel(endPos)) {
        this.lastTapAt = now;
        this.hudMgr.showFor(this.currentModelKey()); // refresh counts (always visible anyway)
      }
    }
    this.tapStartTime = null; this.tapStartPos = null;

    if (this.grabPending && this.grabPendingSide === side) this.cancelGrabPending();
    if (this.grabbing && this.grabSide === side) { this.grabbing = false; this.grabSide = null; }

    const other = side === 'left' ? 'right' : 'left';
    if (!this.hands.state[other].pinch) { this.twoHandActive = false; this.rotVel = 0; }

    this.scrollArmed = false;
    this.scrollDisarmedThisPinch = false;
    this.startDistSurf = null; this.startDistCenter = null;

    this.lastPinchY = null; this.filtPinchY = null; this.scrollAccum = 0; this.pinchStartAt = null;
  }

  // ---------- Scroll (ONE hand, vertical) ----------
  private updateScroll(now:number){
    if (now < this.scrollCooldownUntil) return;
    if (this.grabPending || this.grabbing) return;

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if ((lp && rp) || (!lp && !rp)) return;
    const side: 'left'|'right' = lp ? 'left' : 'right';

    if (this.scrollDisarmedThisPinch) return;
    if (!this.scrollArmed) return;
    if (this.pinchStartAt && (now - this.pinchStartAt) < this.SCROLL_MIN_HOLD_MS) return;

    const mid = this.hands.pinchMid(side);
    if (mid){
      const distSurf = this.distanceToObjectSurface(mid);
      const distCtr = this.store.getObjectWorldPos()?.distanceTo(mid) ?? 1e9;
      if ((distSurf != null && distSurf < this.SCROLL_IN_AIR_DIST) || distCtr < this.SCROLL_START_FAR_CENTER) {
        this.scrollDisarmedThisPinch = true;
        return;
      }
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
      // ensure window updates when feed item changes
      this.hudMgr.showFor(this.currentModelKey());

      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
    }
  }

  // ---------- Two-hand transform (SCALE + ROT) ----------
  private updateTwoHandTransform(dt:number){
    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if (this.grabPending || this.grabbing) return;
    if (!(lp && rp)) { 
      if (this.twoHandActive) { this.twoHandActive = false; this.rotVel = 0; }
      return; 
    }

    const Lp = this.hands.pinchMid('left')  ?? this.hands.thumbTip('left');
    const Rp = this.hands.pinchMid('right') ?? this.hands.thumbTip('right');
    if (!(Lp && Rp)) { 
      if (this.twoHandActive) { this.twoHandActive = false; this.rotVel = 0; }
      return; 
    }

    this.lastL.copy(Lp); this.lastR.copy(Rp);

    const rawDist = Math.max(1e-6, Lp.distanceTo(Rp));
    if (!this.twoHandActive){
      this.twoHandActive = true;

      this.baseDist  = rawDist;
      this.baseScale = this.store.scale;
      this.filtDist  = rawDist;

      this.rotTarget = this.store.rotationY;

      this.LStart.copy(Lp);
      this.RStart.copy(Rp);
      return;
    }

    // SCALE
    this.filtDist = this.filtDist + (rawDist - this.filtDist) * this.LPF_ALPHA;
    const ratio = this.filtDist / this.baseDist;
    let scaleRaw = this.baseScale * Math.pow(ratio, this.SCALE_GAIN);
    scaleRaw = THREE.MathUtils.clamp(scaleRaw, this.SCALE_MIN, this.SCALE_MAX);

    let newScale = this.store.scale;
    if (Math.abs(scaleRaw - this.store.scale) > this.SCALE_DEADBAND) newScale = scaleRaw;

    // ROTATION — yaw in XZ plane
    const lMove = this.lastL.distanceTo(this.LStart);
    const rMove = this.lastR.distanceTo(this.RStart);
    const movedEnough = (lMove + rMove) >= (this.MOVE_EPS * 2);

    const aNow  = Math.atan2(this.lastR.z - this.lastL.z, this.lastR.x - this.lastL.x);
    const aBase = Math.atan2(this.RStart.z - this.LStart.z, this.RStart.x - this.LStart.x);
    let dA = aNow - aBase;

    while (dA >  Math.PI) dA -= 2*Math.PI;
    while (dA < -Math.PI) dA += 2*Math.PI;

    if (movedEnough && Math.abs(dA) >= this.ROT_DEADZONE) {
      dA = THREE.MathUtils.clamp(dA, -this.ROT_MAX_DELTA, this.ROT_MAX_DELTA);
      const desired = this.store.rotationY - dA * this.ROT_GAIN;
      this.rotTarget = desired;
    }

    const smoothed = this.smoothDampAngle(
      this.store.rotationY, this.rotTarget, (v)=> this.rotVel = v, this.rotVel,
      this.ROT_SMOOTH_TIME, this.ROT_MAX_SPEED, dt
    );

    this.store.setTargetTransform(newScale, smoothed);
  }

  private smoothDampAngle(
    current:number, target:number, setVel:(v:number)=>void, currentVel:number,
    smoothTime:number, maxSpeed:number, deltaTime:number
  ){
    let delta = target - current;
    while (delta >  Math.PI) delta -= 2*Math.PI;
    while (delta < -Math.PI) delta += 2*Math.PI;

    target = current + delta;
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    let change = current - target;
    const originalTo = target;

    const maxChange = maxSpeed * smoothTime;
    change = THREE.MathUtils.clamp(change, -maxChange, maxChange);
    target = current - change;

    const temp = (currentVel + omega * (target - current)) * deltaTime;
    const newVel = (currentVel - omega * temp) * exp;
    let output = target + (change + temp) * exp;

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
      this.grabbing = false; this.grabSide = null; return;
    }
    if (!this.hands.state[this.grabSide].pinch){
      this.grabbing = false; this.grabSide = null; return;
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
  private isNearModel(point: THREE.Vector3): boolean {
    const distSurf = this.distanceToObjectSurface(point);
    if (distSurf != null) return distSurf <= this.TAP_OBJ_DIST;
    const center = this.store.getObjectWorldPos();
    if (!center) return false;
    return point.distanceTo(center) <= (this.TAP_OBJ_DIST + 0.08);
  }

  private currentModelKey(): string {
    const anyStore = this.store as any;
    if (typeof anyStore.getCurrentKey === 'function') return String(anyStore.getCurrentKey());
    return 'default';
  }
}
