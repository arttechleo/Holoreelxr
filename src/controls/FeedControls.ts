import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { ThreeXRApp } from '../app/ThreeXRApp';
import { FeedStore } from '../feed/FeedStore';

export class FeedControls {
  // ---- One-hand scroll (vertical) ----
  private lastPinchY: number | null = null;      // use pinch mid Y
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private readonly SCROLL_DISP = 0.010;          // shorter travel → easier scroll (was 0.015)
  private readonly SCROLL_COOLDOWN_MS = 120;     // shorter cooldown
  private readonly SCROLL_NEAR_GRAB = 0.16;      // only used for grab, not for scroll suppression

  // ---- Two-hand transform (scale smooth, rotation snapped with slow cadence) ----
  private twoHandActive = false;
  private baseDist = 0;
  private baseAngle = 0;
  private baseScale = 1;
  private baseRotY = 0;

  private readonly SCALE_GAIN = 2.2;
  private LPF_ALPHA = 0.25;
  private SCALE_DEADBAND = 0.01;
  private filtDist = 0;

  // Rotation snap control (SLOWER)
  private readonly SNAP_RAD = THREE.MathUtils.degToRad(15);
  private readonly SNAP_MIN_DELTA = THREE.MathUtils.degToRad(3); // need at least ~3° change to consider
  private readonly ROT_COOLDOWN_MS = 450;        // was 220 → ~2x slower
  private lastRotSnapAt = 0;

  // Tween between snapped angles (slower)
  private rotTweenActive = false;
  private rotFrom = 0;
  private rotTo = 0;
  private rotT = 0;                               // 0..1
  private readonly ROT_TWEEN_SPEED = 5;           // was 10 → slower

  // lower rotation gain to reduce “jumpiness”
  private readonly ROT_GAIN = 1.0;                // was 2.0

  // track movement per hand to decide which hand is “moving” for rotation
  private LStart = new THREE.Vector3();
  private RStart = new THREE.Vector3();
  private lastL = new THREE.Vector3();
  private lastR = new THREE.Vector3();
  private readonly MOVE_EPS = 0.006;              // 6mm

  // ---- Grab (one hand) ----
  private grabbing = false;
  private grabSide: 'left'|'right' | null = null;
  private grabOffset = new THREE.Vector3();
  private grabPending = false;
  private grabPendingSide: 'left'|'right' | null = null;
  private grabPendingStartY: number | null = null;
  private grabTimer: number | null = null;
  private readonly HOLD_MS = 240;
  private readonly PENDING_CANCEL_MOVE = 0.03;

  // ---- Rays ----
  private rayGroup = new THREE.Group();
  private leftRay?: THREE.Line;  private rightRay?: THREE.Line;
  private rayMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.85, depthTest: false });

  // ---- Reactions ----
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

    // Like → launch from initiating hand (no mirroring)
    this.hands.on('thumbsupstart', (d:any) => {
      const now = performance.now();
      if (now - this.lastLikeAt < this.REACT_COOLDOWN_MS) return;
      this.lastLikeAt = now;

      const side: 'left'|'right' = d?.side === 'left' ? 'left' : 'right';
      const start = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      this.store.likeCurrent(start ?? undefined, side);
    });

    // Heart disabled during two-hand transforms
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

      // rotation tween progression (slow)
      if (this.rotTweenActive) {
        this.rotT = Math.min(1, this.rotT + dt * this.ROT_TWEEN_SPEED);
        const rot = THREE.MathUtils.lerp(this.rotFrom, this.rotTo, this.rotT);
        this.store.setTransform(this.store.scale, rot); // immediate rotation; scale handled via target
        if (this.rotT >= 1) this.rotTweenActive = false;
      }

      this.updateAutoAcquirePending();
      this.updateScroll();
      this.updateTwoHandTransform(now);   // scale smooth; rotation snapped slowly
      this.updateGrabDrag();
      this.updateGrabPendingGuard();
      this.updateRays();

      this.store.tick(dt);                 // smoothing for scale only
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
    const update = (side:'left'|'right', line?:THREE.Line) => {
      if (!line) return;

      const pinching = this.hands.state[side].pinch;
      const show = pinching || (this.grabbing && this.grabSide === side);
      if (!show){ line.visible = false; return; }

      const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      const to = this.store.getObjectWorldPos();
      if (!from || !to){ line.visible = false; return; }

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

    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) this.cancelGrabPending(); else this.tryStartGrabPending(side);

    const y = this.hands.pinchMid(side)?.y ?? null; // pinch Y
    if (y != null) { this.lastPinchY = y; this.scrollAccum = 0; }
  }
  private onPinchEnd(side:'left'|'right'){
    this.setRayVisible(side, false);
    this.lastPinchY = null; this.scrollAccum = 0;
    if (this.grabPending && this.grabPendingSide === side) this.cancelGrabPending();
    if (this.grabbing && this.grabSide === side) { this.grabbing = false; this.grabSide = null; this.store.notify('Placed'); }
  }

  // ---------- Scroll (1-hand, vertical, very responsive) ----------
  private updateScroll(){
    const now = performance.now();
    if (now < this.scrollCooldownUntil) return;
    if (this.grabPending || this.grabbing) return;

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if ((lp && rp) || (!lp && !rp)) return;

    const side: 'left'|'right' = lp ? 'left' : 'right';
    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y == null) return;

    if (this.lastPinchY == null) { this.lastPinchY = y; return; }

    const dy = y - this.lastPinchY;
    this.lastPinchY = y;

    // small velocity boost: if quick flick, amplify
    const boosted = Math.sign(dy) * Math.min(0.06, Math.abs(dy) * 1.5);

    this.scrollAccum += boosted;

    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP){
      const dir = this.scrollAccum < 0 ? +1 : -1;
      this.store.next(dir);
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
    }
  }

  // ---------- Two-hand transform ----------
  private updateTwoHandTransform(now:number){
    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if (this.grabPending || this.grabbing) return;
    if (!(lp && rp)) { this.twoHandActive = false; return; }

    const Lt = this.hands.thumbTip('left');
    const Rt = this.hands.thumbTip('right');
    if (!(Lt && Rt)) { this.twoHandActive = false; return; }

    // Positions this frame
    this.lastL.copy(Lt); this.lastR.copy(Rt);

    const rawDist  = Lt.distanceTo(Rt);
    if (!this.twoHandActive){
      this.twoHandActive = true;
      this.baseDist  = rawDist;
      this.baseAngle = this.angleFromHands(Lt, Rt); // initial angle
      this.baseScale = this.store.scale;
      this.baseRotY  = this.store.rotationY;
      this.filtDist  = rawDist;

      this.LStart.copy(Lt);
      this.RStart.copy(Rt);
      return;
    }

    // ---- Scale: LPF + gain map ----
    this.filtDist = this.filtDist + (rawDist - this.filtDist) * this.LPF_ALPHA;
    const ratio = Math.max(0.01, this.filtDist / this.baseDist);
    const scaleRaw = this.baseScale * Math.pow(ratio, this.SCALE_GAIN);
    const scaleDelta = Math.abs(scaleRaw - this.store.scale);
    const targetScale = scaleDelta > this.SCALE_DEADBAND ? scaleRaw : this.store.scale;
    this.store.setTargetTransform(targetScale, this.store.rotationY);

    // ---- Rotation: stationary→moving hand vector, snap slowly ----
    const lMove = this.lastL.distanceTo(this.LStart);
    const rMove = this.lastR.distanceTo(this.RStart);

    if (lMove + rMove < this.MOVE_EPS * 2) return; // both barely moved

    const stationary = (lMove <= rMove) ? this.lastL : this.lastR;
    const moving     = (lMove <= rMove) ? this.lastR : this.lastL;

    const angleNow = Math.atan2(moving.y - stationary.y, moving.x - stationary.x);
    let dA = angleNow - this.baseAngle;
    while (dA >  Math.PI) dA -= 2*Math.PI;
    while (dA < -Math.PI) dA += 2*Math.PI;

    // natural feel (invert sign), apply gain
    const rotRaw = this.baseRotY - dA * this.ROT_GAIN;

    // ignore tiny changes
    if (Math.abs(rotRaw - this.store.rotationY) < this.SNAP_MIN_DELTA) return;

    // snap target with cooldown and slow tween
    const snapped = Math.round(rotRaw / this.SNAP_RAD) * this.SNAP_RAD;
    if (Math.abs(snapped - this.store.rotationY) > 1e-5) {
      if (now - this.lastRotSnapAt >= this.ROT_COOLDOWN_MS && !this.rotTweenActive) {
        this.lastRotSnapAt = now;
        this.rotTweenActive = true;
        this.rotFrom = this.store.rotationY;
        this.rotTo = snapped;
        this.rotT = 0;
      }
    }

    // keep baseRotY near current to avoid drift
    this.baseRotY = this.store.rotationY;
  }

  private angleFromHands(L:THREE.Vector3, R:THREE.Vector3){
    return Math.atan2(R.y - L.y, R.x - L.x);
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
    if (distSurf != null && distSurf <= this.SCROLL_NEAR_GRAB) {
      this.tryStartGrabPending(side);
    }
  }
  private tryStartGrabPending(side:'left'|'right'){
    if (this.grabbing || this.grabPending) return;
    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) return;
    const pinch = this.hands.pinchMid(side); if (!pinch) return;

    const distSurf = this.distanceToObjectSurface(pinch);
    if (distSurf == null || distSurf > this.SCROLL_NEAR_GRAB) return;

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
    return Math.max(0, distCenter - (radius + 0.04)); // +4cm margin
  }
}
