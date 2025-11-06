import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

export type XRFrameInfo = { frame: XRFrame | null, refSpace: XRReferenceSpace | null };

export class ThreeXRApp {
  public renderer: THREE.WebGLRenderer;
  public scene = new THREE.Scene();
  public camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 100);
  public contentRoot = new THREE.Group();
  private handFactory = new XRHandModelFactory();
  private onFrameCbs: Array<(info: XRFrameInfo) => void> = [];

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');
    document.body.appendChild(this.renderer.domElement);

    document.body.appendChild(ARButton.createButton(this.renderer, {
      requiredFeatures: ['local-floor', 'hand-tracking'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body }
    }));

    // AR passthrough
    this.scene.background = null;

    // Content at the origin (your request)
    this.contentRoot.position.set(0, 0, 0);
    this.scene.add(this.contentRoot);

    // Light
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.9));

    // Visible hand meshes for debugging
    const hands = [this.renderer.xr.getHand(0), this.renderer.xr.getHand(1)];
    hands.forEach(h => {
      this.scene.add(h);
      h.add(this.handFactory.createHandModel(h, 'mesh'));
    });

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth/innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  getHand(side: 'left'|'right') {
    const h0 = this.renderer.xr.getHand(0) as any;
    const h1 = this.renderer.xr.getHand(1) as any;
    const s0 = h0?.handedness, s1 = h1?.handedness;
    if (s0 === side) return h0;
    if (s1 === side) return h1;
    return undefined;
  }

  onFrame(cb: (info: XRFrameInfo) => void){ this.onFrameCbs.push(cb); }

  start(){
    this.renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
      const refSpace: XRReferenceSpace | null = (this.renderer.xr as any).getReferenceSpace?.() ?? null;

      for (const cb of this.onFrameCbs) cb({ frame: frame ?? null, refSpace });
      this.renderer.render(this.scene, this.camera);
    });
  }
}
