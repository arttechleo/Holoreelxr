// src/gestures/HandEngine.ts
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

  private settleMs = 100;
  private smoothFrames = 4;
  private history: Record<string, boolean[]> = {};
  private lastMap = new Map<string,{val:boolean; changeAt:number}>();

  public state = {
    left:  { pinch:false, thumbsup:false },
    right: { pinch:false, thumbsup:false },
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

    // clear
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

    // Pinch
    const leftPinch  = dist(J('left','thumb-tip'),  J('left','index-finger-tip'))  < 0.035;
    const rightPinch = dist(J('right','thumb-tip'), J('right','index-finger-tip')) < 0.035;
    this.state.left.pinch  = leftPinch;  this.updateFlag('left.pinch', leftPinch, {side:'left'});
    this.state.right.pinch = rightPinch; this.updateFlag('right.pinch', rightPinch, {side:'right'});

    // Thumbsup (simple)
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

    // HEART: both index tips close AND both thumb tips close
    const L_i = J('left','index-finger-tip'),  R_i = J('right','index-finger-tip');
    const L_t = J('left','thumb-tip'),        R_t = J('right','thumb-tip');
    const NEAR = 0.045;
    const heartNow = dist(L_i, R_i) < NEAR && dist(L_t, R_t) < NEAR;
    this.state.heart = heartNow; this.updateFlag('heart', heartNow);

    // NEW: ILY/🤟 pose (thumb + index + pinky extended; middle & ring curled)
    const ily = (side:Side) => {
      const W = J(side,'wrist');
      const IT = J(side,'index-finger-tip');
      const PT = J(side,'pinky-finger-tip');
      const TT = J(side,'thumb-tip');
      const MT = J(side,'middle-finger-tip');
      const RT = J(side,'ring-finger-tip');
      if (!(W && IT && PT && TT && MT && RT)) return false;
      const ext = (p:THREE.Vector3|null, thr:number)=> p ? p.distanceTo(W!) > thr : false;
      const cur = (p:THREE.Vector3|null, thr:number)=> p ? p.distanceTo(W!) < thr : false;
      return ext(IT,0.085) && ext(PT,0.085) && ext(TT,0.080) && cur(MT,0.075) && cur(RT,0.075);
    };
    if (ily('left'))  this.emit('ilystart', {side:'left'});
    if (ily('right')) this.emit('ilystart', {side:'right'});
  }

  // -------- helpers used by controls --------
  wristY(side: Side){ const J = this.lastPos[side]['wrist']; return J ? J.y : null; }
  thumbTip(side: Side){ const p = this.lastPos[side]['thumb-tip']; return p ? p.clone() : null; }
  indexTip(side: Side){ const p = this.lastPos[side]['index-finger-tip']; return p ? p.clone() : null; }
  indexProx(side: Side){ const p = this.lastPos[side]['index-finger-phalanx-proximal']; return p ? p.clone() : null; }
  pinchMid(side: Side){
    const t = this.thumbTip(side), i = this.indexTip(side);
    return (t && i) ? t.add(i).multiplyScalar(0.5) : null;
  }
}
