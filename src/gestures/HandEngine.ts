// src/gestures/HandEngine.ts
import * as THREE from 'three';
import type { XRFrameInfo } from '../app/ThreeXRApp';
import { GESTURE } from '../config/constants';

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

  private settleMs = GESTURE.SETTLE_TIME_MS;
  private smoothFrames = GESTURE.SMOOTH_FRAMES;
  private history: Record<string, boolean[]> = {};
  private lastMap = new Map<string,{val:boolean; changeAt:number}>();

  public state = {
    left:  { pinch:false },
    right: { pinch:false },
    heart:false
  };

  private lastPos: Record<'left'|'right', Partial<Record<XRHandJointName, THREE.Vector3>>> = { left:{}, right:{} };

  private listeners: Record<string, Listener[]> = {};
  private heartGraceUntil = 0;
  private lastHeartStable = false;
  on(ev: string, fn: Listener){ (this.listeners[ev] ??= []).push(fn); }
  off(ev: string, fn: Listener){
    const arr = this.listeners[ev];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }
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
    const now = performance.now();
    const session = (this.renderer.xr as any).getSession?.() as XRSession | undefined;
    if (!session || !info.frame || !info.refSpace) return;
    const getJointPose: ((s: XRJointSpace, rs: XRReferenceSpace) => XRJointPose | null) | undefined =
      (info.frame as any).getJointPose?.bind(info.frame);
    if (!getJointPose) return;

    const inputSources = Array.from(session.inputSources || []).filter((s:any)=> !!s.hand);
    if (!inputSources.length) {
      // No hands in frame - reset all gesture states
      this.state.left.pinch = false;
      this.state.right.pinch = false;
      this.state.heart = false;
      return;
    }

    this.lastPos.left = {}; this.lastPos.right = {};
    let leftHandInFrame = false;
    let rightHandInFrame = false;
    
    for (const src of inputSources) {
      const side = (src.handedness === 'left' || src.handedness === 'right') ? src.handedness : 'left';
      const hand = src.hand as XRHand;
      let handHasValidJoints = false;
      
      for (const name of XR_HAND_JOINTS) {
        const js = (hand as any).get?.(name as string) as XRJointSpace | undefined;
        if (!js) continue;
        const jp = getJointPose(js, info.refSpace);
        if (!jp || !jp.transform) continue;
        const { x, y, z } = jp.transform.position;
        (this.lastPos[side][name] ??= new THREE.Vector3()).set(x, y, z);
        handHasValidJoints = true;
      }
      
      if (side === 'left') leftHandInFrame = handHasValidJoints;
      if (side === 'right') rightHandInFrame = handHasValidJoints;
    }
    
    // If hands are not in frame, reset gesture states
    if (!leftHandInFrame) {
      this.state.left.pinch = false;
      this.lastPos.left = {};
    }
    if (!rightHandInFrame) {
      this.state.right.pinch = false;
      this.lastPos.right = {};
    }
    const J = (side:Side, name:XRHandJointName) => this.lastPos[side]?.[name] ?? null;
    const dist = (a:THREE.Vector3|null, b:THREE.Vector3|null) => (a&&b)? a.distanceTo(b) : 1e9;

    // pinch - only detect if hand is in frame
    if (leftHandInFrame) {
      const leftPinch = dist(J('left','thumb-tip'), J('left','index-finger-tip')) < GESTURE.PINCH_THRESHOLD;
      this.state.left.pinch = leftPinch;
      this.updateFlag('left.pinch', leftPinch, {side:'left'});
    }
    if (rightHandInFrame) {
      const rightPinch = dist(J('right','thumb-tip'), J('right','index-finger-tip')) < GESTURE.PINCH_THRESHOLD;
      this.state.right.pinch = rightPinch;
      this.updateFlag('right.pinch', rightPinch, {side:'right'});
    }

    // heart gesture: ONLY check if BOTH hands are in frame (with small grace period)
    if (!leftHandInFrame || !rightHandInFrame) {
      if (this.lastHeartStable && now < this.heartGraceUntil) {
        this.state.heart = true;
        this.updateFlag('heart', true);
      } else if (this.lastHeartStable) {
        this.lastHeartStable = false;
        this.state.heart = false;
        this.updateFlag('heart', false);
      } else {
        this.state.heart = false;
      }
    } else {
      // Both hands in frame - check heart gesture
      const L_i = J('left','index-finger-tip'),  R_i = J('right','index-finger-tip');
      const L_t = J('left','thumb-tip'),        R_t = J('right','thumb-tip');
      
      // All required joints must be present
      if (!L_i || !R_i || !L_t || !R_t) {
        if (this.lastHeartStable && now < this.heartGraceUntil) {
          this.state.heart = true;
          this.updateFlag('heart', true);
        } else {
          this.lastHeartStable = false;
          this.state.heart = false;
          this.updateFlag('heart', false);
        }
      } else {
        // TUTORIAL-STYLE HEART GESTURE: Simple and reliable detection (matches tutorial)
        // Heart gesture: Both hands come together - thumbs AND index fingers are close
        
        const indexDist = dist(L_i, R_i);
        const thumbDist = dist(L_t, R_t);
        
        // SIMPLE DETECTION: Both pairs must be close (within 15cm) - same as tutorial
        const HEART_DISTANCE = 0.15; // 15cm
        const indexClose = indexDist < HEART_DISTANCE;
        const thumbClose = thumbDist < HEART_DISTANCE;
        
        // Both pairs must be close for heart gesture
        const heartNow = indexClose && thumbClose;
        
        // DEBUG: Log heart gesture detection (throttled to avoid spam)
        if (Math.random() < 0.02) {  // 2% of frames
          console.log('[Heart Debug]', {
            indexDist: (indexDist * 100).toFixed(1) + 'cm',
            thumbDist: (thumbDist * 100).toFixed(1) + 'cm',
            threshold: (GESTURE.HEART_THRESHOLD * 100).toFixed(1) + 'cm',
            maxDistFromCenter: (maxDistFromCenter * 100).toFixed(1) + 'cm',
            indexClose,
            thumbClose,
            strictHeart,
            oneVeryClose,
            shapeHeart,
            heartNow
          });
        }
        
        if (heartNow) {
          this.heartGraceUntil = now + 220;
        }
        this.lastHeartStable = heartNow;
        this.state.heart = heartNow; 
        this.updateFlag('heart', heartNow);
      }
    }

    // thumbs up (like) - only detect if hand is in frame AND not pinching
    const thumbUp = (side:Side) => {
      const inFrame = side === 'left' ? leftHandInFrame : rightHandInFrame;
      if (!inFrame) return false;
      
      // CRITICAL: Do not detect thumbs up if hand is pinching (prevents false positives)
      const isPinching = side === 'left' ? this.state.left.pinch : this.state.right.pinch;
      if (isPinching) return false;
      
      const W = J(side,'wrist'), T = J(side,'thumb-tip');
      if (!W || !T) return false;
      
      // Thumb must be extended (away from wrist)
      const thumbExtended = T.distanceTo(W) > GESTURE.FINGER_EXTENDED_THRESHOLD;
      if (!thumbExtended) return false;
      
      // All other fingers must be curled (close to wrist)
      const curled = ['index-finger-tip','middle-finger-tip','ring-finger-tip','pinky-finger-tip']
        .every(n => { 
          const P = J(side, n as XRHandJointName);
          return P && P.distanceTo(W) < GESTURE.FINGER_CURLED_THRESHOLD;
        });
      
      return curled;
    };
    if (thumbUp('left'))  this.emit('thumbsupstart',{side:'left'});
    if (thumbUp('right')) this.emit('thumbsupstart',{side:'right'});


    // PEACE ✌️ (index + middle extended; ring + pinky curled; thumb relaxed)
    // Only detect if hand is in frame
    const peace = (side:Side) => {
      const inFrame = side === 'left' ? leftHandInFrame : rightHandInFrame;
      if (!inFrame) return false;
      
      const W = J(side,'wrist');
      const IT = J(side,'index-finger-tip'), MT = J(side,'middle-finger-tip');
      const RT = J(side,'ring-finger-tip'),  PT = J(side,'pinky-finger-tip');
      if (!(W && IT && MT && RT && PT)) return false;
      const ext = (p:THREE.Vector3|null, thr:number)=> p ? p.distanceTo(W!) > thr : false;
      const cur = (p:THREE.Vector3|null, thr:number)=> p ? p.distanceTo(W!) < thr : false;
      return ext(IT,GESTURE.FINGER_EXTENDED_THRESHOLD) && ext(MT,GESTURE.FINGER_EXTENDED_THRESHOLD) && cur(RT,GESTURE.FINGER_CURLED_THRESHOLD) && cur(PT,GESTURE.FINGER_CURLED_THRESHOLD);
    };
    if (peace('left'))  this.emit('peacestart',{side:'left'});
    if (peace('right')) this.emit('peacestart',{side:'right'});
  }

  // helpers
  thumbTip(side: Side){ const p = this.lastPos[side]['thumb-tip']; return p ? p.clone() : null; }
  indexTip(side: Side){ const p = this.lastPos[side]['index-finger-tip']; return p ? p.clone() : null; }
  wrist(side: Side){ const p = this.lastPos[side]['wrist']; return p ? p.clone() : null; }
  pinchMid(side: Side){
    const t = this.thumbTip(side), i = this.indexTip(side);
    return (t && i) ? t.clone().add(i).multiplyScalar(0.5) : null;
  }
}
