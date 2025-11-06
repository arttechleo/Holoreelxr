// Minimal declarations to quiet older lib.dom.d.ts installs.
// Safe to keep even if your TS already has these types.

type XRHandJoint =
  | 'wrist'
  | 'thumb-metacarpal' | 'thumb-phalanx-proximal' | 'thumb-phalanx-distal' | 'thumb-tip'
  | 'index-finger-metacarpal' | 'index-finger-phalanx-proximal' | 'index-finger-phalanx-intermediate' | 'index-finger-phalanx-distal' | 'index-finger-tip'
  | 'middle-finger-metacarpal' | 'middle-finger-phalanx-proximal' | 'middle-finger-phalanx-intermediate' | 'middle-finger-phalanx-distal' | 'middle-finger-tip'
  | 'ring-finger-metacarpal' | 'ring-finger-phalanx-proximal' | 'ring-finger-phalanx-intermediate' | 'ring-finger-phalanx-distal' | 'ring-finger-tip'
  | 'pinky-finger-metacarpal' | 'pinky-finger-phalanx-proximal' | 'pinky-finger-phalanx-intermediate' | 'pinky-finger-phalanx-distal' | 'pinky-finger-tip';

interface XRHand extends Map<XRHandJoint, XRJointSpace> {
  get(key: XRHandJoint): XRJointSpace | undefined;
  keys(): IterableIterator<XRHandJoint>;
  values(): IterableIterator<XRJointSpace>;
  entries(): IterableIterator<[XRHandJoint, XRJointSpace]>;
}

interface XRJointPose {
  readonly transform: XRRigidTransform;
}

interface XRJointSpace extends EventTarget {}
