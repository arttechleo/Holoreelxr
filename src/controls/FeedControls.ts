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

  // Scroll arming/disarm so drag doesn't scroll content
  private scrollArmed = false;              // becomes true only if pinch starts FAR from the object
  private scrollDisarmedThisPinch = false;  // set true if this pinch should never scroll feed

  private readonly SCROLL_MIN_HOLD_MS = 140;
  private readonly SCROLL_DISP = 0.028;
  private readonly SCROLL_COOLDOWN_MS = 330;
  private readonly SCROLL_VEL_MIN = 0.010;
  private readonly SCROLL_IN_AIR_DIST = 0.24;   // "near object" if < this
  private readonly SCROLL_START_FAR = 0.28;     // must start >= this far to arm scrolling
  private readonly LPF_SCROLL_ALPHA = 0.22;

  // ===== Panel scroll (1-hand vertical near the panel) =====
  private panelScrollMode = false;
  private readonly PANEL_W_M = 0.50;        // must match ReactionHud.PANEL_W
  private readonly PANEL_H_M = 0.30;        // must match ReactionHud.PANEL_H
  private readonly PANEL_OFFSET_Y = 0.22;   // must match ReactionHud offset.y
  private readonly PANEL_SCROLL_STEP_MULT = 1.0;

  // ===== Two-hand transform (scale + rotation) =====
  private twoHandActive = false;

  // scale state
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

  // ===== Grab (one hand hold) =====
  private grabbing = false;
  private grabSide: 'left'|'right' | null = null;
  private grabOffset = new THREE.Vector3();
  private grabPending = false;
  private grabPendingSide: 'left'|'right' | null = null;
  private grabPendingStartY: number | null = null;
  private grabTimer: number | null = null;

  private readonly HOLD_MS = 150;
  private readonly PENDING_CANCEL_MOVE = 0.06;
  private readonly INSTANT_GRAB_DIST = 0.14; // slightly more forgiving

  // ===== Rays =====
  private rayGroup = new THREE.Group();
  private leftRay?: THREE.Line;  private rightRay?: THREE.Line;
  private rayMat = new THREE.LineDashedMaterial({
    color: 0xffffff, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9, depthTest: false
  });

  // ===== Reactions =====
  private lastLikeAt = 0;
  private lastHeartAt = 0;
  private lastRepostAt = 0;
  private readonly REACT_COOLDOWN_MS = 800;

  // HUD (panel always visible, position-anchored)
  private hudMgr: ReactionHudManager;

  // Quick pinch ("tap") helpers
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

    // HUD manager — position-anchored; always visible
    this.hudMgr = new ReactionHudManager(
      this.app.scene,
      this.app.camera,
      () => this.store.getObjectWorldPos()
    );
    // Provide icons (ensure files exist)
    this.hudMgr.setIcons('/assets/ui/heart.png', '/assets/ui/like.png', '/assets/ui/repost.png');
    // Always show panel for current model
    this.hudMgr.showFor(this.currentModelKey());

    // Hand lifecycle
    this.hands.on('leftpinchstart',  () => this.onPinchStart('left'));
    this.hands.on('rightpinchstart', () => this.onPinchStart('right'));
    this.hands.on('leftpinchend',    () => this.onPinchEnd('left'));
    this.hands.on('rightpinchend',   () => this.onPinchEnd('right'));

    // L gesture → just ensure visible (we keep it visible anyway)
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

    // Peace sign → Repost (listen to multiple event names to be safe)
    const onRepost = (d:any) => {
      const now = performance.now();
      if (now - this.lastRepostAt < this.REACT_COOLDOWN_MS) return;
      this.lastRepostAt = now;

      const side: 'left'|'right' = d?.side === 'left' ? 'left' : 'right';
      const start = this.hands.indexTip(side) ?? this.hands.pinchMid(side) ?? this.hands.thumbTip(side) ?? undefined;
      this.store.repostCurrent(start ?? undefined);
      this.hudMgr.bump(this.currentModelKey(), 'repost');
    };
    this.hands.on('peacesignstart', onRepost);
    this.hands.on('victorystart',   onRepost);    // alias
    this.hands.on('twoustart',      onRepost);    // alias

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

  // ---------- Pinch lifecycle (with scroll arming/disarm + instant grab + panel interactions) ----------
  private onPinchStart(side:'left'|'right'){
    this.setRayVisible(side, true);

    this.pinchStartAt = performance.now();
    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y != null) {
      this.lastPinchY = y;
      this.filtPinchY = y;
      this.scrollAccum = 0;
    }

    // reset per-pinch gating
    this.scrollDisarmedThisPinch = false;
    this.scrollArmed = false;
    this.panelScrollMode = false;

    // quick pinch baseline
    this.tapStartTime = performance.now();
    this.tapStartPos = this.hands.pinchMid(side)?.clone() ?? this.hands.thumbTip(side)?.clone() ?? null;

    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) {
      this.twoHandActive = false;
      return;
    }

    const pinch = this.hands.pinchMid(side);
    const d = pinch ? this.distanceToObjectSurface(pinch) : null;

    // If near panel center → enable panel scroll mode immediately
    if (pinch && this.isNearPanel(pinch)) {
      this.panelScrollMode = true;
      this.scrollDisarmedThisPinch = true; // don't let feed scroll on this pinch
      return;
    }

    // if we start very close to the model → instant grab
    if (d != null && d <= this.INSTANT_GRAB_DIST) {
      const objPosNow = this.store.getObjectWorldPos();
      if (objPosNow && pinch) {
        this.grabbing = true; this.grabSide = side;
        this.grabOffset.copy(objPosNow).sub(pinch);
        this.store.notify('Grabbed');
        this.scrollDisarmedThisPinch = true; // dragging should never scroll
        return;
      }
    }

    // not close enough to grab → only arm scrolling if we started FAR from object
    if (d != null && d >= this.SCROLL_START_FAR) {
      this.scrollArmed = true;
    } else {
      // started somewhat near → do NOT allow scrolling this pinch
      this.scrollDisarmedThisPinch = true;
      this.tryStartGrabPending(side);
    }
  }

  private onPinchEnd(side:'left'|'right'){
    this.setRayVisible(side, false);

    const now = performance.now();
    const duration = this.tapStartTime ? (now - this.tapStartTime) : Infinity;
    const endPos = this.hands.pinchMid(side)?.clone() ?? this.hands.thumbTip(side)?.clone() ?? null;

    if (this.tapStartPos && endPos && duration <= this.TAP_MAX_MS && (now - this.lastTapAt) >= this.TAP_COOLDOWN_MS) {
      const travel = this.tapStartPos.distanceTo(endPos);
      if (travel <= this.TAP_MOVE_MAX) {
        this.lastTapAt = now;

        // --- PANEL BUTTONS / COMMENTS ---
        const hit = this.hudMgr.hitTestWorld(endPos);
        if (hit) {
          if (hit.kind === 'like' || hit.kind === 'heart' || hit.kind === 'repost') {
            // route to counters + store reaction (for particles/platform pulse)
            if (hit.kind === 'like')  this.store.likeCurrent(endPos.clone(), side);
            if (hit.kind === 'heart') this.store.saveCurrent(endPos.clone());
            if (hit.kind === 'repost') this.store.repostCurrent(endPos.clone());
            this.hudMgr.bump(this.currentModelKey(), hit.kind);
          } else if (hit.kind === 'post') {
            this.hudMgr.postQuickComment();
            this.store.notify('Comment posted');
          } else if (hit.kind === 'comments') {
            // no-op here (scroll happens while pinching near panel)
          }
          // done; skip feed/UI show
        } else if (this.isNearModel(endPos)) {
          // quick tap near model → ensure current model HUD is bound
          this.hudMgr.showFor(this.currentModelKey());
        }
      }
    }
    this.tapStartTime = null; this.tapStartPos = null;

    if (this.grabPending && this.grabPendingSide === side) this.cancelGrabPending();
    if (this.grabbing && this.grabSide === side) { this.grabbing = false; this.grabSide = null; this.store.notify('Placed'); }

    const other = side === 'left' ? 'right' : 'left';
    if (!this.hands.state[other].pinch) { this.twoHandActive = false; this.rotVel = 0; }

    // reset gating at end of pinch
    this.scrollArmed = false;
    this.scrollDisarmedThisPinch = false;
    this.panelScrollMode = false;

    this.lastPinchY = null; this.filtPinchY = null; this.scrollAccum = 0; this.pinchStartAt = null;
  }

  // ---------- Scroll (ONE hand, vertical) + Panel comment scroll ----------
  private updateScroll(now:number){
    if (now < this.scrollCooldownUntil) return;
    if (this.grabPending || this.grabbing) return;

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    if ((lp && rp) || (!lp && !rp)) return; // exactly one hand
    const side: 'left'|'right' = lp ? 'left' : 'right';

    const mid = this.hands.pinchMid(side);
    if (!mid) return;

    // If near panel during this pinch → treat vertical motion as comments scroll
    if (this.panelScrollMode || this.isNearPanel(mid)) {
      this.panelScrollMode = true;

      const y = mid.y;
      if (y == null) return;

      if (this.filtPinchY == null) this.filtPinchY = y;
      this.filtPinchY = this.filtPinchY + (y - this.filtPinchY) * this.LPF_SCROLL_ALPHA;

      if (this.lastPinchY == null) { this.lastPinchY = this.filtPinchY; return; }

      const dy = this.filtPinchY - this.lastPinchY;
      this.lastPinchY = this.filtPinchY;

      if (Math.abs(dy) < this.SCROLL_VEL_MIN) return;

      this.scrollAccum += dy;

      if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP){
        const steps = (this.scrollAccum < 0 ? +1 : -1) * this.PANEL_SCROLL_STEP_MULT;
        this.hudMgr.scrollComments(steps);
        this.scrollAccum = 0;
        this.scrollCooldownUntil = now + 140; // snappier for comments
      }
      return;
    }

    // ---- FEED SCROLL ----
    if (this.scrollDisarmedThisPinch) return; // disarmed pinch should never scroll feed
    if (!this.scrollArmed) return;            // must have started FAR from object
    if (this.pinchStartAt && (now - this.pinchStartAt) < this.SCROLL_MIN_HOLD_MS) return;

    if (mid){
      // If during the pinch we come close to the object, permanently disarm scrolling for this pinch
      const distSurf = this.distanceToObjectSurface(mid);
      if (distSurf != null && distSurf < this.SCROLL_IN_AIR_DIST) {
        this.scrollDisarmedThisPinch = true; // turn off scrolling until pinch end
        return;
      }
    }

    const y = mid.y ?? null;
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
      // re-bind HUD to the new model (per-model counters/comments)
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
  private isNearModel(point: THREE.Vector3): boolean {
    const distSurf = this.distanceToObjectSurface(point);
    if (distSurf != null) return distSurf <= this.TAP_OBJ_DIST;
    const center = this.store.getObjectWorldPos();
    if (!center) return false;
    return point.distanceTo(center) <= (this.TAP_OBJ_DIST + 0.08);
  }

  /** Check if the hand point is within the panel's footprint (world AABB around panel center). */
  private isNearPanel(point: THREE.Vector3): boolean {
    const pc = this.getPanelCenter();
    if (!pc) return false;
    const halfW = this.PANEL_W_M * 0.55;
    const halfH = this.PANEL_H_M * 0.55;
    const dx = Math.abs(point.x - pc.x);
    const dy = Math.abs(point.y - pc.y);
    const dz = Math.abs(point.z - pc.z);
    const withinXZ = (dx <= halfW) && (Math.abs(point.z - pc.z) <= halfW);
    const withinY  = (dy <= halfH);
    return withinXZ && withinY;
  }

  private getPanelCenter(): THREE.Vector3 | null {
    const obj = this.store.getObjectWorldPos();
    if (!obj) return null;
    return obj.clone().add(new THREE.Vector3(0, this.PANEL_OFFSET_Y, 0));
  }

  private currentModelKey(): string {
    const anyStore = this.store as any;
    if (typeof anyStore.getCurrentKey === 'function') return String(anyStore.getCurrentKey());
    return 'default';
  }
}
