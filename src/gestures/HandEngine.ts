import * as THREE from 'three';
import type { XRFrameInfo } from '../app/ThreeXRApp';

type Side = 'left'|'right';
type Listener = (detail?: any) => void;

const XR_HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip',
  'ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip',
  'pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip'
] as const;
type XRHandJointName = typeof XR_HAND_JOINTS[number];

export class HandEngine {
  constructor(public renderer: THREE.WebGLRenderer) {}

  private settleMs = 140;             // slightly longer to stabilize L detection
  private smoothFrames = 5;
  private history: Record<string, boolean[]> = {};
  private lastMap = new Map<string,{val:boolean; changeAt:number}>();

  public state = {
    left:  { pinch:false, thumbsup:false, lshape:false },
    right: { pinch:false, thumbsup:false, lshape:false },
    heart:false
  };

  private lastPos: Record<'left'|'right', Partial<Record<XRHandJointName, THREE.Vector3>>> = { left:{}, right:{} };

  private listeners: Record<string, Listener[]> = {};
  on(ev: string, fn: Listener){ (this.listeners[ev] ??= []).push(fn); }
  private emit(ev: string, detail?: any){ (this.listeners[ev]||[]).forEach(f=>f(detail)); }

  private smooth(key:string, v:boolean){
    const buf=this.history[key]??(this.history[key]=[]);
    buf.push(v); if(buf.length>this.smoothFrames) buf.shift();
    return buf.filter(Boolean).length >= Math.ceil(buf.length*0.6);
  }
  private updateFlag(key:string, val:boolean, payload?:any){
    const now=performance.now(); const rec=this.lastMap.get(key)??{val:false,changeAt:0};
    const sVal=this.smooth(key,val);
    if(sVal!==rec.val){
      if(!rec.changeAt) rec.changeAt=now;
      if(now-rec.changeAt>=this.settleMs){
        rec.val=sVal; rec.changeAt=0; this.lastMap.set(key,rec);
        const ev = key.replace('.', '') + (sVal?'start':'end');
        this.emit(ev, payload);
      }
    } else { rec.changeAt=0; this.lastMap.set(key,rec); }
  }

  update(info: XRFrameInfo){
    const session = (this.renderer.xr as any).getSession?.() as XRSession | undefined;
    if (!session || !info.frame || !info.refSpace) return;
    const getJointPose: ((s: XRJointSpace, rs: XRReferenceSpace) => XRJointPose | null) | undefined =
      (info.frame as any).getJointPose?.bind(info.frame);
    if (!getJointPose) return;

    const inputSources = Array.from(session.inputSources || []).filter((s:any)=> !!s.hand);
    if (!inputSources.length) return;

    this.lastPos.left = {}; this.lastPos.right = {};
    for (const src of inputSources) {
      const side = (src.handedness === 'left' || src.handedness === 'right') ? src.handedness : 'left';
      const hand = src.hand as XRHand;
      for (const name of XR_HAND_JOINTS) {
        const js = (hand as any).get?.(name as string) as XRJointSpace | undefined;
        if (!js) continue;
        const jp = getJointPose(js, info.refSpace);
        if (!jp || !jp.transform) continue;
        const { x, y, z } = jp.transform.position;
        (this.lastPos[side][name] ??= new THREE.Vector3()).set(x, y, z);
      }
    }

    const J = (side:Side, name:XRHandJointName) => this.lastPos[side]?.[name] ?? null;
    const dist = (a:THREE.Vector3|null, b:THREE.Vector3|null) => (a&&b)? a.distanceTo(b) : 1e9;

    // ---------- Pinch ----------
    const leftPinch  = dist(J('left','thumb-tip'),  J('left','index-finger-tip'))  < 0.035;
    const rightPinch = dist(J('right','thumb-tip'), J('right','index-finger-tip')) < 0.035;
    this.state.left.pinch  = leftPinch;
    this.state.right.pinch = rightPinch;
    this.updateFlag('left.pinch', leftPinch, {side:'left'});
    this.updateFlag('right.pinch', rightPinch, {side:'right'});

    // ---------- Thumbs up (unchanged lightweight) ----------
    const thumbUp = (side:Side) => {
      const W = J(side,'wrist'), T = J(side,'thumb-tip');
      if (!W || !T) return false;
      const thumbExtended = T.distanceTo(W) > 0.085;
      const curled = ['index-finger-tip','middle-finger-tip','ring-finger-tip','pinky-finger-tip']
        .every(n => { const P=J(side, n as XRHandJointName); return P && P.distanceTo(W) < 0.075; });
      return thumbExtended && curled;
    };
    if (thumbUp('left'))  this.emit('thumbsupstart',{side:'left'});
    if (thumbUp('right')) this.emit('thumbsupstart',{side:'right'});

    // ---------- Heart (two hands together) ----------
    const L_i = J('left','index-finger-tip');
    const R_i = J('right','index-finger-tip');
    const L_t = J('left','thumb-tip');
    const R_t = J('right','thumb-tip');
    const NEAR = 0.045;
    const heartNow = dist(L_i, R_i) < NEAR && dist(L_t, R_t) < NEAR;
    this.state.heart = heartNow;
    this.updateFlag('heart', heartNow);

    // ---------- L-shaped gesture (robust) ----------
    // Criteria (per hand):
    // - Index extended from wrist (> 10–12 cm depending on scale)
    // - Thumb extended from wrist (> ~7 cm)
    // - Angle between index & thumb ≈ 90° (60°–120°)
    // - Other fingers curled (tip near wrist OR near their proximal joint)
    // - Not pinching (index–thumb distance must be sufficiently large)
    const L_EXT_I = 0.11;   // index extension threshold
    const L_EXT_T = 0.075;  // thumb extension threshold
    const L_MIN_SEP = 0.055; // guard: not pinching
    const ANG_MIN = THREE.MathUtils.degToRad(60);
    const ANG_MAX = THREE.MathUtils.degToRad(120);

    const isCurled = (side:Side, tip:XRHandJointName, prox:XRHandJointName, wrist:THREE.Vector3) => {
      const tp = J(side, tip), px = J(side, prox);
      if (!(tp && px)) return false;
      // close to wrist OR close to its proximal joint
      return (tp.distanceTo(wrist) < 0.075) || (tp.distanceTo(px) < 0.045);
    };

    const lShape = (side:Side) => {
      const W = J(side,'wrist');
      const I0 = J(side,'index-finger-metacarpal'), I1 = J(side,'index-finger-tip');
      const T0 = J(side,'thumb-metacarpal'),       T1 = J(side,'thumb-tip');
      if (!(W && I0 && I1 && T0 && T1)) return false;

      // not a pinch
      if (I1.distanceTo(T1) < L_MIN_SEP) return false;

      const indexExtended = I1.distanceTo(W) > L_EXT_I;
      const thumbExtended = T1.distanceTo(W) > L_EXT_T;

      const vI = I1.clone().sub(I0).normalize();
      const vT = T1.clone().sub(T0).normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(vI.dot(vT), -1, 1));

      const othersCurled =
        isCurled(side,'middle-finger-tip','middle-finger-phalanx-proximal', W) &&
        isCurled(side,'ring-finger-tip','ring-finger-phalanx-proximal', W) &&
        isCurled(side,'pinky-finger-tip','pinky-finger-phalanx-proximal', W);

      return indexExtended && thumbExtended && (angle > ANG_MIN && angle < ANG_MAX) && othersCurled;
    };

    const leftL  = lShape('left');
    const rightL = lShape('right');
    this.state.left.lshape  = leftL;
    this.state.right.lshape = rightL;
    this.updateFlag('left.lshape',  leftL,  {side:'left'});
    this.updateFlag('right.lshape', rightL, {side:'right'});
  }

  wristY(side: Side){ const J = this.lastPos[side]['wrist']; return J ? J.y : null; }
  thumbTip(side: Side){ const p = this.lastPos[side]['thumb-tip']; return p ? p.clone() : null; }
  indexTip(side: Side){ const p = this.lastPos[side]['index-finger-tip']; return p ? p.clone() : null; }
  pinchMid(side: Side){
    const t = this.thumbTip(side), i = this.indexTip(side);
    return (t && i) ? t.add(i).multiplyScalar(0.5) : null;
  }
}
