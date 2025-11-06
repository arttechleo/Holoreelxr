declare module 'three/examples/jsm/webxr/VRButton.js' {
  export const VRButton: any;
}

declare module 'three/examples/jsm/webxr/XRHandModelFactory.js' {
  export class XRHandModelFactory {
    createHandModel(hand: any, model: 'mesh' | 'spheres'): any;
  }
}

declare module 'three/examples/jsm/loaders/PLYLoader.js' {
  import * as THREE from 'three';
  export class PLYLoader {
    load(
      url: string,
      onLoad: (geometry: THREE.BufferGeometry) => void,
      onProgress?: (ev: ProgressEvent<EventTarget>) => void,
      onError?: (err: unknown) => void
    ): void;
  }
}
