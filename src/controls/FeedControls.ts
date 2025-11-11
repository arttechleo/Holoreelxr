import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { ThreeXRApp } from '../app/ThreeXRApp';
import { FeedStore } from '../feed/FeedStore';
import ReactionHudManager from '../ui/ReactionHudManager';

export class FeedControls {
  // ----- feed scroll -----
  private lastPinchY: number | null = null;
  private filtPinchY: number | null = null;
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private pinchStartAt: number | null = null;
  private scrollArmed = false;
  private scrollDisarmedThisPinch = false;

  // Tuned to make scrolling easier again
  private readonly SCROLL_MIN_HOLD_MS = 120;
  private readonly SCROLL_DISP = 0.026;
  private readonly SCROLL_COOLDOWN_MS = 300;
  private readonly SCROLL_VEL_MIN = 0.008;
  private readonly SCROLL_IN_AIR_DIST = 0.20;
  private readonly SCROLL_START_FAR = 0.20;
  private readonly LPF_SCROLL_ALPHA = 0.22;

  // transform / grab
  private twoHandActive = false;
  private baseDist = 0; private baseScale = 1; private filtDist = 0;
  private readonly LPF_ALPHA = 0.28; private readonly SCALE_GAIN = 2.2; private readonly SCALE_DEADBAND = 0.004; private readonly SCALE_MIN = 0.15; private readonly SCALE_MAX = 8;
  private rotTarget = 0; private rotVel = 0;
  private readonly ROT_GAIN = 0.9; private readonly ROT_DEADZONE = THREE.MathUtils.degToRad(1.0); private readonly ROT_MAX_DELTA = THREE.MathUtils.degToRad(60);
  private readonly ROT_SMOOTH_TIME = 0.12; private readonly ROT_MAX_SPEED = THREE.MathUtils.degToRad(360);
  private LStart = new THREE.Vector3(); private RStart = new THREE.Vector3();
  private lastL = new THREE.Vector3(); private lastR = new THREE.Vector3(); private readonly MOVE_EPS = 0.006;
  private grabbing = false; private grabSide: 'left'|'right' | null = null; private grabOffset = new THREE.Vector3();
  private grabPending = false; private grabPendingSide: 'left'|'right' | null = null; private grabPendingStartY: number | null = null; private grabTimer: number | null = null;
  private readonly HOLD_MS = 150; private readonly PENDING_CANCEL_MOVE = 0.06; private readonly INSTANT_GRAB_DIST = 0.14;

  // rays (visual helpers only; kept off while UI is hit)
  private rayGroup = new THREE.Group();
  private leftRay?: THREE.Line;  private rightRay?: THREE.Line;
  private rayMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9, depthTest: false });

  // reaction throttles (incl. repost – fixes spam)
  private lastLikeAt = 0; private lastHeartAt = 0; private lastRepostAt = 0;
  private readonly REACT_COOLDOWN_MS = 800;

  // UI dwell assist (camera→index finger)
  private readonly DWELL_MS = 350;
  private uiHoverKind: string | null = null; private uiHoverBeganAt = 0; private uiLastY: number | null = null;

  private hudMgr: ReactionHudManager;
  private selectBoundForSession: XRSession | null = null;

  constructor(private app: ThreeXRApp, private hands: HandEngine, private store: FeedStore) {
    this.app.scene.add(this.rayGroup); this.initRay('left'); this.initRay('right'); this.setRayVisible('left', false); this.setRayVisible('right', false);

    this.hudMgr = new ReactionHudManager(this.app.scene, this.app.camera, () => this.store.getObjectWorldPos());
    this.hudMgr.setIcons('/assets/ui/heart.png', '/assets/ui/like.png', '/assets/ui/repost.png');
    this.hudMgr.showFor(this.currentModelKey());

    // pinch lifecycle
    this.hands.on('leftpinchstart',  () => this.onPinchStart('left'));
    this.hands.on('rightpinchstart', () => this.onPinchStart('right'));
    this.hands.on('leftpinchend',    () => this.onPinchEnd('left'));
    this.hands.on('rightpinchend',   () => this.onPinchEnd('right'));

    // Like / Heart
    this.hands.on('thumbsupstart', () => {
      const now=performance.now(); if(now-this.lastLikeAt<this.REACT_COOLDOWN_MS) return; this.lastLikeAt=now;
      this.store.likeCurrent(); this.hudMgr.bump(this.currentModelKey(),'like');
    });
    this.hands.on('heartstart', () => {
      const now=performance.now(); if(now-this.lastHeartAt<this.REACT_COOLDOWN_MS) return; this.lastHeartAt=now;
      this.store.saveCurrent(); this.hudMgr.bump(this.currentModelKey(),'heart');
    });

    // ILY → open compose (keyboard hook)
    this.hands.on('ilystart', () => { this.hudMgr.beginCommentEntry(); });

    // Peace → repost (debounced to fix spam) + trigger store visuals
    this.hands.on('peacestart', () => {
      const now=performance.now();
      if(now-this.lastRepostAt<this.REACT_COOLDOWN_MS) return;
      this.lastRepostAt=now;
      this.store.repostCurrent();
      this.hudMgr.bump(this.currentModelKey(),'repost');
    });

    // WebXR select: pinch-click on UI panel
    this.installSelectHandlers();

    // frame
    let last = performance.now();
    this.app.onFrame(() => {
      const now = performance.now(); const dt = Math.max(0,(now-last)/1000); last = now;

      // dwell ray (extra help on runtimes that don’t send select)
      this.updateUiRayAndDwell(now);

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

  // ---------- Try to click HUD directly from pinch start ----------
  private tryClickHud(side: 'left'|'right'): boolean {
    const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
    if (!from) return false;

    const panelCenter = this.hudMgr.getPanelCenterWorld();
    const dir = panelCenter.clone().sub(from).normalize();
    const ray = new THREE.Ray(from.clone(), dir);

    const hit = this.hudMgr.raycastHit(ray);
    if (!hit) return false;

    // Hide helper ray for this pinch — user clicked UI, not content
    this.setRayVisible(side, false);

    // Handle HUD hit
    const key = this.currentModelKey();
    if (hit.kind === 'like')       { this.store.likeCurrent(from.clone(), side); this.hudMgr.bump(key,'like'); }
    else if (hit.kind === 'heart') { this.store.saveCurrent(from.clone());        this.hudMgr.bump(key,'heart'); }
    else if (hit.kind === 'repost'){
      const now=performance.now();
      if(now-this.lastRepostAt>=this.REACT_COOLDOWN_MS){
        this.lastRepostAt=now;
        this.store.repostCurrent(from.clone(), side);
        this.hudMgr.bump(key,'repost');
      }
    }
    else if (hit.kind === 'post' || hit.kind === 'compose')  { this.hudMgr.beginCommentEntry(''); }

    // swallow pinch so it doesn't scroll/grab this time
    this.scrollDisarmedThisPinch = true;
    this.grabPending = false;
    this.grabbing = false;
    return true;
  }

  // ---------- WebXR select → click HUD ----------
  private installSelectHandlers(){
    const xr = (this.app.renderer.xr as any);
    const ensure = () => {
      const sess = xr.getSession?.() as XRSession | undefined;
      if (!sess) return;
      if (this.selectBoundForSession === sess) return; // avoid duplicates
      this.selectBoundForSession = sess;
      const getRef = () => xr.getReferenceSpace?.() as XRReferenceSpace;

      const clickFromEvent = (ev: any) => {
        const frame: XRFrame | undefined = ev?.frame;
        const ref = getRef(); if (!frame || !ref) return;
        const pose = frame.getPose(ev.inputSource?.targetRaySpace as XRSpace, ref);
        if (!pose) return;
        const o = new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        const d = new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(
          pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w
        )).normalize();
        const ray = new THREE.Ray(o, d);
        const hit = this.hudMgr.raycastHit(ray);
        if (!hit) return;

        const key = this.currentModelKey();
        if (hit.kind === 'like')       { this.store.likeCurrent();   this.hudMgr.bump(key,'like'); }
        else if (hit.kind === 'heart') { this.store.saveCurrent();   this.hudMgr.bump(key,'heart'); }
        else if (hit.kind === 'repost') {
          const now=performance.now();
          if(now-this.lastRepostAt>=this.REACT_COOLDOWN_MS){
            this.lastRepostAt=now;
            this.store.repostCurrent();
            this.hudMgr.bump(key,'repost');
          }
        }
        else if (hit.kind === 'post' || hit.kind === 'compose')  { this.hudMgr.beginCommentEntry(); }
      };

      // bind once per XRSession
      sess.addEventListener('select', clickFromEvent);
    };

    ensure();
    xr.addEventListener?.('sessionstart', ensure);
  }

  // ---------- dwell assist (camera→index finger) ----------
  private updateUiRayAndDwell(now:number){
    const tip = this.hands.indexTip('right') ?? this.hands.indexTip('left');
    if (!tip) { this.uiHoverKind = null; this.uiLastY = null; return; }
    const camPos = new THREE.Vector3(); this.app.camera.getWorldPosition(camPos);
    const dir = tip.clone().sub(camPos).normalize();
    const ray = new THREE.Ray(camPos, dir);

    const hit = this.hudMgr.raycastHit(ray);
    const hitKind = hit?.kind ?? null;

    if (hitKind === 'comments') {
      const y = tip.y; if (this.uiLastY == null) this.uiLastY = y;
      const dy = y - this.uiLastY; this.uiLastY = y;
      if (Math.abs(dy) >= 0.010) { this.hudMgr.scrollComments(dy<0?+1:-1); this.uiHoverKind='comments'; this.uiHoverBeganAt = now; return; }
    } else { this.uiLastY = null; }

    if (hitKind !== this.uiHoverKind) { this.uiHoverKind = hitKind; this.uiHoverBeganAt = now; return; }
    if (!hitKind) return;

    if (now - this.uiHoverBeganAt >= this.DWELL_MS) {
      this.uiHoverBeganAt = now + 10000;
      const key = this.currentModelKey();
      if (hitKind === 'like')       { this.store.likeCurrent(); this.hudMgr.bump(key,'like'); }
      else if (hitKind === 'heart') { this.store.saveCurrent(); this.hudMgr.bump(key,'heart'); }
      else if (hitKind === 'repost'){
        const n=performance.now();
        if(n-this.lastRepostAt>=this.REACT_COOLDOWN_MS){
          this.lastRepostAt=n;
          this.store.repostCurrent();
          this.hudMgr.bump(key,'repost');
        }
      }
      else if (hitKind === 'post' || hitKind === 'compose')  { this.hudMgr.beginCommentEntry(); }
    }
  }

  // ---------- rays (visual helpers only) ----------
  private initRay(side:'left'|'right'){
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geom, this.rayMat); (line as any).computeLineDistances?.();
    if (side==='left'){ this.leftRay = line; } else { this.rightRay = line; }
    this.rayGroup.add(line);
  }
  private setRayVisible(side:'left'|'right', v:boolean){ const L = side==='left' ? this.leftRay : this.rightRay; if (L) L.visible = v; }
  private updateRays(){
    const objPos = this.store.getObjectWorldPos();
    const fallbackDir = new THREE.Vector3(0,0,-1);
    const update = (side:'left'|'right', line?:THREE.Line) => {
      if (!line) return;
      const pinching = this.hands.state[side].pinch;
      const show = pinching && !this.scrollDisarmedThisPinch && !this.grabbing && !this.hudMgr.isComposing(); // keep off while composing
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
    update('left', this.leftRay); update('right', this.rightRay);
  }

  // ---------- pinch lifecycle / feed scroll ----------
  private onPinchStart(side:'left'|'right'){
    // First, try clicking the MR HUD; if it handled, do not show dotted ray.
    if (this.tryClickHud(side)) return;

    this.setRayVisible(side, true);
    this.pinchStartAt = performance.now();
    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y != null) { this.lastPinchY=y; this.filtPinchY=y; this.scrollAccum=0; }
    this.scrollDisarmedThisPinch=false; this.scrollArmed=false;

    const other = side==='left'?'right':'left';
    if (this.hands.state[other].pinch) { this.twoHandActive=false; return; }

    const pinch = this.hands.pinchMid(side);
    const d = pinch ? this.distanceToObjectSurface(pinch) : null;

    if (d != null && d <= this.INSTANT_GRAB_DIST) {
      const objPosNow = this.store.getObjectWorldPos();
      if (objPosNow && pinch) {
        this.grabbing = true; this.grabSide = side; this.grabOffset.copy(objPosNow).sub(pinch);
        this.store.notify('Grabbed'); this.scrollDisarmedThisPinch = true; return;
      }
    }

    if (d != null && d >= this.SCROLL_START_FAR) this.scrollArmed = true;
    else { this.scrollDisarmedThisPinch = true; this.tryStartGrabPending(side); }
  }

  private onPinchEnd(side:'left'|'right'){
    this.setRayVisible(side, false);
    if (this.grabPending && this.grabPendingSide === side) this.cancelGrabPending();
    if (this.grabbing && this.grabSide === side) { this.grabbing=false; this.grabSide=null; this.store.notify('Placed'); }
    const other = side==='left'?'right':'left';
    if (!this.hands.state[other].pinch) { this.twoHandActive=false; this.rotVel=0; }
    this.scrollArmed=false; this.scrollDisarmedThisPinch=false;
    this.lastPinchY=null; this.filtPinchY=null; this.scrollAccum=0; this.pinchStartAt=null;
  }

  private updateScroll(now:number){
    if (now < this.scrollCooldownUntil) return;
    if (this.grabPending || this.grabbing) return;

    const lp = this.hands.state.left.pinch, rp = this.hands.state.right.pinch;
    if ((lp && rp) || (!lp && !rp)) return;
    const side: 'left'|'right' = lp ? 'left' : 'right';

    if (this.scrollDisarmedThisPinch || !this.scrollArmed) return;
    if (this.pinchStartAt && (now - this.pinchStartAt) < this.SCROLL_MIN_HOLD_MS) return;

    const mid = this.hands.pinchMid(side);
    if (mid){
      const distSurf = this.distanceToObjectSurface(mid);
      if (distSurf != null && distSurf < this.SCROLL_IN_AIR_DIST) { this.scrollDisarmedThisPinch = true; return; }
    }

    const y = this.hands.pinchMid(side)?.y ?? null; if (y == null) return;
    if (this.filtPinchY == null) this.filtPinchY = y;
    this.filtPinchY = this.filtPinchY + (y - this.filtPinchY) * this.LPF_SCROLL_ALPHA;
    if (this.lastPinchY == null) { this.lastPinchY = this.filtPinchY; return; }

    const dy = this.filtPinchY - this.lastPinchY; this.lastPinchY = this.filtPinchY;
    if (Math.abs(dy) < this.SCROLL_VEL_MIN) return;

    this.scrollAccum += dy;
    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP){
      const dir = this.scrollAccum < 0 ? +1 : -1;
      this.store.next(dir);
      // Keep HUD counts/comments synced with the newly active item
      this.hudMgr.showFor(this.currentModelKey());
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
    }
  }

  // ---------- two-hand transform ----------
  private updateTwoHandTransform(dt:number){
    const lp = this.hands.state.left.pinch, rp = this.hands.state.right.pinch;
    if (this.grabPending || this.grabbing) return;
    if (!(lp && rp)) { if (this.twoHandActive){ this.twoHandActive=false; this.rotVel=0; } return; }

    const Lp = this.hands.pinchMid('left')  ?? this.hands.thumbTip('left');
    const Rp = this.hands.pinchMid('right') ?? this.hands.thumbTip('right');
    if (!(Lp && Rp)) { if (this.twoHandActive){ this.twoHandActive=false; this.rotVel=0; } return; }

    this.lastL.copy(Lp); this.lastR.copy(Rp);

    const rawDist = Math.max(1e-6, Lp.distanceTo(Rp));
    if (!this.twoHandActive){
      this.twoHandActive = true; this.baseDist=rawDist; this.baseScale=this.store.scale; this.filtDist=rawDist;
      this.rotTarget = this.store.rotationY; this.LStart.copy(Lp); this.RStart.copy(Rp); return;
    }

    this.filtDist = this.filtDist + (rawDist - this.filtDist) * this.LPF_ALPHA;
    const ratio = this.filtDist / this.baseDist;
    let scaleRaw = this.baseScale * Math.pow(ratio, this.SCALE_GAIN);
    scaleRaw = THREE.MathUtils.clamp(scaleRaw, this.SCALE_MIN, this.SCALE_MAX);

    let newScale = this.store.scale;
    if (Math.abs(scaleRaw - this.store.scale) > this.SCALE_DEADBAND) newScale = scaleRaw;

    const lMove = this.lastL.distanceTo(this.LStart);
    const rMove = this.lastR.distanceTo(this.RStart);
    const movedEnough = (lMove + rMove) >= (this.MOVE_EPS * 2);

    const aNow  = Math.atan2(this.lastR.z - this.lastL.z, this.lastR.x - this.lastL.x);
    const aBase = Math.atan2(this.RStart.z - this.LStart.z, this.RStart.x - this.LStart.x);
    let dA = aNow - aBase; while (dA > Math.PI) dA -= 2*Math.PI; while (dA < -Math.PI) dA += 2*Math.PI;

    if (movedEnough && Math.abs(dA) >= this.ROT_DEADZONE) {
      dA = THREE.MathUtils.clamp(dA, -this.ROT_MAX_DELTA, this.ROT_MAX_DELTA);
      const desired = this.store.rotationY - dA * this.ROT_GAIN;
      this.rotTarget = desired;
    }

    const smoothed = this.smoothDampAngle(this.store.rotationY, this.rotTarget, (v)=> this.rotVel = v, this.rotVel, this.ROT_SMOOTH_TIME, this.ROT_MAX_SPEED, dt);
    this.store.setTargetTransform(newScale, smoothed);
  }
  private smoothDampAngle(current:number, target:number, setVel:(v:number)=>void, currentVel:number, smoothTime:number, maxSpeed:number, deltaTime:number){
    let delta = target - current;
    while (delta >  Math.PI) delta -= 2*Math.PI;
    while (delta < -Math.PI) delta += 2*Math.PI;
    target = current + delta;
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48*x*x + 0.235*x*x*x);
    let change = current - target; const originalTo = target;
    const maxChange = maxSpeed * smoothTime;
    change = THREE.MathUtils.clamp(change, -maxChange, maxChange); target = current - change;
    const temp = (currentVel + omega * (target - current)) * deltaTime;
    const newVel = (currentVel - omega * temp) * exp;
    let output = target + (change + temp) * exp;
    const origDelta = originalTo - current, outDelta = output - originalTo;
    if (origDelta * outDelta > 0) { output = originalTo; setVel(0); return output; }
    setVel(newVel); return output;
  }

  // ---------- grab ----------
  private updateAutoAcquirePending(){
    if (this.grabPending || this.grabbing) return;
    const lp = this.hands.state.left.pinch, rp = this.hands.state.right.pinch;
    if (lp === rp) return;
    const side: 'left'|'right' = lp ? 'left' : 'right';
    const other = lp ? 'right' : 'left';
    if (this.hands.state[other].pinch) return;
    const pinch = this.hands.pinchMid(side); if (!pinch) return;
    const distSurf = this.distanceToObjectSurface(pinch);
    if (distSurf != null && distSurf <= 0.18) this.tryStartGrabPending(side);
  }
  private tryStartGrabPending(side:'left'|'right'){
    if (this.grabbing || this.grabPending) return;
    const other = side==='left'?'right':'left';
    if (this.hands.state[other].pinch) return;
    const pinch = this.hands.pinchMid(side); if (!pinch) return;
    const distSurf = this.distanceToObjectSurface(pinch); if (distSurf == null || distSurf > 0.18) return;
    this.grabPending = true; this.grabPendingSide = side; this.grabPendingStartY = this.hands.pinchMid(side)?.y ?? null;
    if (this.grabTimer != null) clearTimeout(this.grabTimer);
    this.grabTimer = window.setTimeout(() => {
      if (!this.grabPending || this.grabPendingSide !== side) return;
      const other = side==='left'?'right':'left';
      const stillPinching = this.hands.state[side].pinch && !this.hands.state[other].pinch;
      const mid = this.hands.pinchMid(side); const objPosNow = this.store.getObjectWorldPos();
      if (!stillPinching || !mid || !objPosNow) { this.cancelGrabPending(); return; }
      this.grabOffset.copy(objPosNow).sub(mid);
      this.grabPending=false; this.grabPendingSide=null; this.grabPendingStartY=null;
      this.grabbing=true; this.grabSide=side; this.store.notify('Grabbed – move your hand to place');
    }, this.HOLD_MS);
  }
  private cancelGrabPending(){ this.grabPending=false; this.grabPendingSide=null; this.grabPendingStartY=null; if (this.grabTimer != null) { clearTimeout(this.grabTimer); this.grabTimer=null; } }
  private updateGrabPendingGuard(){
    if (!this.grabPending || !this.grabPendingSide) return;
    const yNow = this.hands.pinchMid(this.grabPendingSide)?.y ?? null;
    if (yNow != null && this.grabPendingStartY != null) { if (Math.abs(yNow - this.grabPendingStartY) > this.PENDING_CANCEL_MOVE) { this.cancelGrabPending(); return; } }
    const other = this.grabPendingSide==='left'?'right':'left'; if (this.hands.state[other].pinch) this.cancelGrabPending();
  }
  private updateGrabDrag(){
    if (!this.grabbing || !this.grabSide) return;
    const other = this.grabSide==='left'?'right' : 'left';
    if (this.hands.state[this.grabSide].pinch && this.hands.state[other].pinch){ this.grabbing=false; this.grabSide=null; this.store.notify('Grab canceled (two-hand mode)'); return; }
    if (!this.hands.state[this.grabSide].pinch){ this.grabbing=false; this.grabSide=null; this.store.notify('Placed'); return; }
    const mid = this.hands.pinchMid(this.grabSide); if (!mid) return;
    this.store.setPosition(mid.clone().add(this.grabOffset));
  }

  // helpers
  private distanceToObjectSurface(worldPoint: THREE.Vector3): number | null {
    const info = this.store.getObjectBounds(); if (!info) return null;
    const { center, radius } = info; const distCenter = worldPoint.distanceTo(center);
    return Math.max(0, distCenter - (radius + 0.04));
  }
  private currentModelKey(): string { const anyStore = this.store as any; if (typeof anyStore.getCurrentKey === 'function') return String(anyStore.getCurrentKey()); return 'default'; }
}
