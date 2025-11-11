import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

export type XRFrameInfo = { frame: XRFrame | null, refSpace: XRReferenceSpace | null };

export class ThreeXRApp {
  public renderer: THREE.WebGLRenderer;
  public scene = new THREE.Scene();
  public camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 100);
  public contentRoot = new THREE.Group();

  private onFrameCbs: Array<(info: XRFrameInfo) => void> = [];
  private refSpace: XRReferenceSpace | null = null;
  private handFactory = new XRHandModelFactory();
  private handsAdded = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');
    document.body.appendChild(this.renderer.domElement);

    // transparent for AR passthrough
    this.scene.background = null;

    // world
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.9));
    this.scene.add(this.contentRoot);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth/innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // XR lifecycle → keep DOM overlay class and a stable refSpace
    this.renderer.xr.addEventListener('sessionstart', async () => {
      this.refSpace = await (this.renderer.xr as any).getReferenceSpace?.() ?? null;
      document.body.classList.add('xr-overlay');
      this.ensureDebugHands();  // add once per app
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.refSpace = null;
      document.body.classList.remove('xr-overlay');
    });

    this.wireExplicitButtons();
  }

  onFrame(cb: (info: XRFrameInfo) => void){ this.onFrameCbs.push(cb); }

  start(){
    this.renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
      const refSpace = this.refSpace ?? ((this.renderer.xr as any).getReferenceSpace?.() ?? null);
      for (const cb of this.onFrameCbs) cb({ frame: frame ?? null, refSpace });
      this.renderer.render(this.scene, this.camera);
    });
  }

  // =============== Buttons (explicit AR/VR) ===============
  private wireExplicitButtons() {
    const arBtn = document.getElementById('enter-ar') as HTMLButtonElement | null;
    const vrBtn = document.getElementById('enter-vr') as HTMLButtonElement | null;

    const setLabel = (el: HTMLButtonElement | null, label: string, enabled: boolean) => {
      if (!el) return; el.textContent = label; el.disabled = !enabled;
    };

    const init = async () => {
      const xr = (navigator as any).xr as XRSystem | undefined;
      if (!xr) {
        setLabel(arBtn, 'AR not available', false);
        setLabel(vrBtn, 'VR not available', false);
        return;
      }
      const hasAR = await xr.isSessionSupported('immersive-ar').catch(()=>false);
      const hasVR = await xr.isSessionSupported('immersive-vr').catch(()=>false);
      setLabel(arBtn, hasAR ? 'Enter AR' : 'AR not supported', !!hasAR);
      setLabel(vrBtn, hasVR ? 'Enter VR' : 'VR not supported', !!hasVR);

      // AR flow (dom-overlay + hands)
      arBtn?.addEventListener('click', async () => {
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local-floor', 'hand-tracking'] as any,
          optionalFeatures: ['dom-overlay', 'hit-test'],
          // @ts-ignore
          domOverlay: { root: document.body }
        };
        const session = await xr.requestSession('immersive-ar', sessionInit as any);
        await (this.renderer.xr as any).setSession(session);
      });

      // VR flow (hands; dom-overlay is AR-only)
      vrBtn?.addEventListener('click', async () => {
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local-floor', 'hand-tracking'] as any,
          optionalFeatures: []
        };
        const session = await xr.requestSession('immersive-vr', sessionInit as any);
        await (this.renderer.xr as any).setSession(session);
      });
    };

    init().catch(console.error);
  }

  // Visible hand meshes to help debug/align gestures
  private ensureDebugHands() {
    if (this.handsAdded) return;
    const h0 = this.renderer.xr.getHand(0);
    const h1 = this.renderer.xr.getHand(1);
    this.scene.add(h0, h1);
    h0.add(this.handFactory.createHandModel(h0, 'mesh'));
    h1.add(this.handFactory.createHandModel(h1, 'mesh'));
    this.handsAdded = true;
  }
}
