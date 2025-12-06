// src/gestures/HandEngine.ts
import * as THREE from 'three';
import type { XRFrameInfo } from '../app/ThreeXRApp';
import { GESTURE } from '../config/constants';

type Side = 'left'|'right';
type Listener = (detail?: any) => void;

export const HAND_JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip',
  'ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip',
  'pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip'
] as const;
export type HandJointName = typeof HAND_JOINT_NAMES[number];

export const HAND_BONE_CONNECTIONS: ReadonlyArray<[HandJointName, HandJointName]> = [
  ['wrist', 'thumb-metacarpal'],
  ['thumb-metacarpal', 'thumb-phalanx-proximal'],
  ['thumb-phalanx-proximal', 'thumb-phalanx-distal'],
  ['thumb-phalanx-distal', 'thumb-tip'],

  ['wrist', 'index-finger-metacarpal'],
  ['index-finger-metacarpal', 'index-finger-phalanx-proximal'],
  ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate'],
  ['index-finger-phalanx-intermediate', 'index-finger-phalanx-distal'],
  ['index-finger-phalanx-distal', 'index-finger-tip'],

  ['wrist', 'middle-finger-metacarpal'],
  ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal'],
  ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate'],
  ['middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal'],
  ['middle-finger-phalanx-distal', 'middle-finger-tip'],

  ['wrist', 'ring-finger-metacarpal'],
  ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal'],
  ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate'],
  ['ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal'],
  ['ring-finger-phalanx-distal', 'ring-finger-tip'],

  ['wrist', 'pinky-finger-metacarpal'],
  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal'],
  ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate'],
  ['pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal'],
  ['pinky-finger-phalanx-distal', 'pinky-finger-tip'],
] as const;

export type HandJointPayload = Partial<Record<HandJointName, { x: number; y: number; z: number }>>;
export interface HandJointSnapshot {
  left: HandJointPayload;
  right: HandJointPayload;
}

export class HandEngine {
  constructor(public renderer: THREE.WebGLRenderer) {}

  private settleMs = GESTURE.SETTLE_TIME_MS;
  private smoothFrames = GESTURE.SMOOTH_FRAMES;
  private history: Record<string, boolean[]> = {};
  private lastMap = new Map<string,{val:boolean; changeAt:number}>();

  public state = {
    left:  { pinch:false, open:false },
    right: { pinch:false, open:false },
    heart:false,
    stopPalm:false  // CRITICAL: Added for multiplayer panel trigger
  };

  private lastPos: Record<'left'|'right', Partial<Record<HandJointName, THREE.Vector3>>> = { left:{}, right:{} };
  private lastRot: Record<'left'|'right', Partial<Record<HandJointName, THREE.Quaternion>>> = { left:{}, right:{} };

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

  getJointSnapshot(): HandJointSnapshot {
    const left: HandJointPayload = {};
    const right: HandJointPayload = {};
    for (const name of HAND_JOINT_NAMES) {
      const lp = this.lastPos.left[name];
      if (lp) {
        left[name] = { x: lp.x, y: lp.y, z: lp.z };
      }
      const rp = this.lastPos.right[name];
      if (rp) {
        right[name] = { x: rp.x, y: rp.y, z: rp.z };
      }
    }
    return { left, right };
  }

  getJointQuaternion(side: Side, name: HandJointName): THREE.Quaternion | null {
    const rot = this.lastRot[side][name];
    return rot ? rot.clone() : null;
  }

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
    // CRITICAL FIX: Enhanced null safety and error handling
    try {
      const now = performance.now();
      const session = (this.renderer.xr as any).getSession?.() as XRSession | undefined;
      if (!session || !info?.frame || !info?.refSpace) {
        // CRITICAL FIX: Reset gesture states when session/info is invalid
        this.state.left.pinch = false;
        this.state.right.pinch = false;
        this.state.heart = false;
        this.state.stopPalm = false;
        return;
      }
      
      const getJointPose: ((s: XRJointSpace, rs: XRReferenceSpace) => XRJointPose | null) | undefined =
        (info.frame as any).getJointPose?.bind(info.frame);
      if (!getJointPose) {
        // CRITICAL FIX: Reset gesture states when joint pose unavailable
        this.state.left.pinch = false;
        this.state.right.pinch = false;
        this.state.heart = false;
        this.state.stopPalm = false;
        return;
      }

    const inputSources = Array.from(session.inputSources || []).filter((s:any)=> !!s.hand);
    if (!inputSources.length) {
      // No hands in frame - reset all gesture states
      this.state.left.pinch = false;
      this.state.right.pinch = false;
      this.state.heart = false;
      this.state.stopPalm = false;  // CRITICAL: Reset stopPalm
      return;
    }

    this.lastPos.left = {}; this.lastPos.right = {};
    let leftHandInFrame = false;
    let rightHandInFrame = false;
    
    for (const src of inputSources) {
      const side = (src.handedness === 'left' || src.handedness === 'right') ? src.handedness : 'left';
      const hand = src.hand as XRHand;
      let handHasValidJoints = false;
      
      for (const name of HAND_JOINT_NAMES) {
        const js = (hand as any).get?.(name as string) as XRJointSpace | undefined;
        if (!js) continue;
        const jp = getJointPose(js, info.refSpace);
        if (!jp || !jp.transform) continue;
        const { x, y, z } = jp.transform.position;
        (this.lastPos[side][name] ??= new THREE.Vector3()).set(x, y, z);
        if (jp.transform.orientation) {
          const { x: qx, y: qy, z: qz, w: qw } = jp.transform.orientation;
          (this.lastRot[side][name] ??= new THREE.Quaternion()).set(qx, qy, qz, qw);
        }
        handHasValidJoints = true;
      }
      
      if (side === 'left') leftHandInFrame = handHasValidJoints;
      if (side === 'right') rightHandInFrame = handHasValidJoints;
    }
    
    // If hands are not in frame, reset gesture states
    if (!leftHandInFrame) {
      this.state.left.pinch = false;
      this.lastPos.left = {};
      this.lastRot.left = {};
    }
    if (!rightHandInFrame) {
      this.state.right.pinch = false;
      this.lastPos.right = {};
      this.lastRot.right = {};
    }
    const J = (side:Side, name:HandJointName) => {
      // CRITICAL FIX: Enhanced null safety
      if (!this.lastPos[side]) return null;
      return this.lastPos[side][name] ?? null;
    };
    const dist = (a:THREE.Vector3|null, b:THREE.Vector3|null) => {
      // CRITICAL FIX: Validate vectors before distance calculation
      if (!a || !b) return 1e9;
      try {
        return a.distanceTo(b);
      } catch (error) {
        console.error('[HandEngine] Distance calculation error:', error);
        return 1e9;
      }
    };

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
      // Both hands in frame - REFINED heart gesture using joints 7, 8, 9
      
      const L_i_mid = J('left','index-finger-phalanx-intermediate');
      const L_i_dist = J('left','index-finger-phalanx-distal');
      const L_i_tip = J('left','index-finger-tip');
      
      const R_i_mid = J('right','index-finger-phalanx-intermediate');
      const R_i_dist = J('right','index-finger-phalanx-distal');
      const R_i_tip = J('right','index-finger-tip');
      
      const L_thumb = J('left','thumb-tip');
      const R_thumb = J('right','thumb-tip');
      
      // If any critical joints missing, fall back to grace logic
      const allIndexOk =
        L_i_mid && L_i_dist && L_i_tip &&
        R_i_mid && R_i_dist && R_i_tip &&
        L_thumb && R_thumb;
      
      if (!allIndexOk) {
        if (this.lastHeartStable && now < this.heartGraceUntil) {
          this.state.heart = true;
          this.updateFlag('heart', true);
        } else {
          this.lastHeartStable = false;
          this.state.heart = false;
          this.updateFlag('heart', false);
        }
        return;
      }
      
      // 1) Build index "ridge" cluster points (using 7,8,9)
      const leftIndexCluster = L_i_mid.clone()
        .add(L_i_dist)
        .add(L_i_tip)
        .multiplyScalar(1 / 3);
      
      const rightIndexCluster = R_i_mid.clone()
        .add(R_i_dist)
        .add(R_i_tip)
        .multiplyScalar(1 / 3);
      
      // 2) Distances
      const indexClusterDist = dist(leftIndexCluster, rightIndexCluster);
      const thumbDist = dist(L_thumb, R_thumb);
      
      // Slightly tighter than old index distance, thumb can be a bit looser
      const HEART_INDEX_MAX = 0.10; // ~10 cm between index ridges
      const HEART_THUMB_MAX = 0.14; // ~14 cm between thumbs
      
      const indexClose = indexClusterDist < HEART_INDEX_MAX;
      const thumbsClose = thumbDist < HEART_THUMB_MAX;
      
      // 3) Check index fingers face each other (direction constraint)
      //    Use 7→9 (intermediate to tip) as direction
      const L_indexDir = L_i_tip.clone().sub(L_i_mid).normalize();
      const R_indexDir = R_i_tip.clone().sub(R_i_mid).normalize();
      
      const across = rightIndexCluster.clone().sub(leftIndexCluster).normalize();
      const acrossLeftToRight = across;         // L → R
      const acrossRightToLeft = across.clone().multiplyScalar(-1); // R → L
      
      // Both fingers should roughly point along the line between the hands
      const L_facing = L_indexDir.dot(acrossLeftToRight);
      const R_facing = R_indexDir.dot(acrossRightToLeft);
      
      // Thresholds: 1.0 is perfectly aligned, 0 is perpendicular.
      // 0.2–0.3 is a gentle "generally pointing inward".
      const FACING_MIN_DOT = 0.25;
      const indicesFacingEachOther = (L_facing > FACING_MIN_DOT) && (R_facing > FACING_MIN_DOT);
      
      // 4) Final heart decision
      const heartNow = indexClose && thumbsClose && indicesFacingEachOther;
      
      if (heartNow) {
        this.heartGraceUntil = now + 220;
      }
      this.lastHeartStable = heartNow;
      this.state.heart = heartNow;
      this.updateFlag('heart', heartNow);
    }

    // OPEN PALM detection (used for gesture sync + stop palm)
    const openPalm = (side: Side) => {
      const inFrame = side === 'left' ? leftHandInFrame : rightHandInFrame;
      if (!inFrame) return false;
      const W = J(side, 'wrist');
      if (!W) return false;
      const fingerTips: HandJointName[] = [
        'index-finger-tip',
        'middle-finger-tip',
        'ring-finger-tip',
        'pinky-finger-tip',
        'thumb-tip',
      ];
      return fingerTips.every((name) => {
        const tip = J(side, name);
        return tip ? tip.distanceTo(W) > GESTURE.FINGER_EXTENDED_THRESHOLD * 0.85 : false;
      });
    };
    this.state.left.open = openPalm('left');
    this.state.right.open = openPalm('right');

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
        const P = J(side, n as HandJointName);
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

    // STOP PALM 🖐️ (all fingers extended, palm facing forward)
    // Used to trigger multiplayer panel
    // CRITICAL: Only detect on right hand to prevent accidental triggers
    const stopPalm = (side: Side) => {
      if (side !== 'right') return false;
      if (!rightHandInFrame) return false;
      
      // Don't detect if pinching (user is interacting)
      if (this.state.right.pinch) return false;
      
      return openPalm('right');
    };
    
    // Only detect on RIGHT hand to prevent accidental triggers
    this.state.stopPalm = stopPalm('right');
    this.updateFlag('stopPalm', this.state.stopPalm);
    } catch (error) {
      // CRITICAL FIX: Don't crash on hand tracking errors - reset states safely
      console.error('[HandEngine] Error in update:', error);
      this.state.left.pinch = false;
      this.state.right.pinch = false;
      this.state.heart = false;
      this.state.stopPalm = false;
    }
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
