/**
 * Extended WebXR type definitions to reduce 'any' usage
 */

// Extend the existing XRWebGLLayer interface
declare global {
  interface XRSession {
    addEventListener(
      type: 'select' | 'selectstart' | 'selectend' | 'squeezestart' | 'squeezeend' | 'end',
      listener: (event: XRInputSourceEvent) => void
    ): void;
    removeEventListener(
      type: 'select' | 'selectstart' | 'selectend' | 'squeezestart' | 'squeezeend' | 'end',
      listener: (event: XRInputSourceEvent) => void
    ): void;
  }

  interface XRInputSourceEvent extends Event {
    frame: XRFrame;
    inputSource: XRInputSource;
  }

  interface XRFrame {
    /**
     * Get the pose of a joint space relative to a reference space
     */
    getJointPose?(jointSpace: XRJointSpace, referenceSpace: XRReferenceSpace): XRJointPose | null;
  }

  interface XRJointPose extends XRPose {
    radius?: number;
  }

  interface XRJointSpace extends XRSpace {
    jointName?: string;
  }

  interface XRHand extends Iterable<[string, XRJointSpace]> {
    get(key: string): XRJointSpace | undefined;
    size: number;
    keys(): IterableIterator<string>;
    values(): IterableIterator<XRJointSpace>;
    entries(): IterableIterator<[string, XRJointSpace]>;
    forEach(callback: (value: XRJointSpace, key: string, map: XRHand) => void): void;
  }

  interface XRInputSource {
    hand?: XRHand;
  }
}

// Three.js WebXR extensions
export interface ThreeWebXRManager {
  enabled: boolean;
  isPresenting: boolean;
  
  addEventListener(type: 'sessionstart' | 'sessionend', listener: (event: any) => void): void;
  removeEventListener(type: 'sessionstart' | 'sessionend', listener: (event: any) => void): void;
  
  setReferenceSpaceType?(type: XRReferenceSpaceType): void;
  getReferenceSpace?(): XRReferenceSpace | null;
  getSession?(): XRSession | null;
  setSession(session: XRSession): Promise<void>;
  
  getHand(index: number): THREE.Group;
  getController(index: number): THREE.Group;
  getControllerGrip(index: number): THREE.Group;
}

export interface XRFrameInfo {
  frame: XRFrame | null;
  refSpace: XRReferenceSpace | null;
}

// Hand joint names as a type
export type XRHandJointName =
  | 'wrist'
  | 'thumb-metacarpal'
  | 'thumb-phalanx-proximal'
  | 'thumb-phalanx-distal'
  | 'thumb-tip'
  | 'index-finger-metacarpal'
  | 'index-finger-phalanx-proximal'
  | 'index-finger-phalanx-intermediate'
  | 'index-finger-phalanx-distal'
  | 'index-finger-tip'
  | 'middle-finger-metacarpal'
  | 'middle-finger-phalanx-proximal'
  | 'middle-finger-phalanx-intermediate'
  | 'middle-finger-phalanx-distal'
  | 'middle-finger-tip'
  | 'ring-finger-metacarpal'
  | 'ring-finger-phalanx-proximal'
  | 'ring-finger-phalanx-intermediate'
  | 'ring-finger-phalanx-distal'
  | 'ring-finger-tip'
  | 'pinky-finger-metacarpal'
  | 'pinky-finger-phalanx-proximal'
  | 'pinky-finger-phalanx-intermediate'
  | 'pinky-finger-phalanx-distal'
  | 'pinky-finger-tip';

export type HandSide = 'left' | 'right';

export {};

