import * as THREE from 'three';

export type XRFrameInfo = { frame: XRFrame | null, refSpace: XRReferenceSpace | null };

export class ThreeXRApp {
  public renderer: THREE.WebGLRenderer;
  public scene = new THREE.Scene();
  public camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, 0.01, 100);
  public contentRoot = new THREE.Group();

  private onFrameCbs: Array<(info: XRFrameInfo) => void> = [];
  private refSpace: XRReferenceSpace | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');
    document.body.appendChild(this.renderer.domElement);

    // AR passthrough
    this.scene.background = null;

    // Content at origin
    this.contentRoot.position.set(0, 0, 0);
    this.scene.add(this.contentRoot);

    // Light
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.9));

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth/innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // Session lifecycle
    this.renderer.xr.addEventListener('sessionstart', async () => {
      const rs = await (this.renderer.xr as any).getReferenceSpace?.() as XRReferenceSpace | null;
      this.refSpace = rs ?? null;
      document.body.classList.add('xr-overlay');
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.refSpace = null;
      document.body.classList.remove('xr-overlay');
    });

    this.wireStartXRButton();
  }

  onFrame(cb: (info: XRFrameInfo) => void){ this.onFrameCbs.push(cb); }

  start(){
    this.renderer.setAnimationLoop((_t: number, frame?: XRFrame) => {
      const refSpace = this.refSpace ?? ((this.renderer.xr as any).getReferenceSpace?.() ?? null);
      for (const cb of this.onFrameCbs) cb({ frame: frame ?? null, refSpace });
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** One consistent button that prefers immersive-ar (with hand-tracking + dom-overlay), falls back to immersive-vr. */
  private wireStartXRButton() {
    const btn = document.getElementById('start-xr') as HTMLButtonElement | null;
    if (!btn) return;

    const wantFeatures: XRSessionInit = {
      requiredFeatures: ['local-floor', 'hand-tracking'] as any,
      optionalFeatures: ['dom-overlay', 'hit-test'],
      // @ts-ignore
      domOverlay: { root: document.body }
    };

    const set = (label: string, enabled: boolean) => {
      btn.textContent = label;
      btn.disabled = !enabled;
    };

    const trySupport = async () => {
      const xr = (navigator as any).xr as XRSystem | undefined;
      if (!xr) { set('XR not available', false); return { hasAR:false, hasVR:false }; }
      const hasAR = await xr.isSessionSupported('immersive-ar').catch(()=>false);
      const hasVR = await xr.isSessionSupported('immersive-vr').catch(()=>false);
      set(hasAR ? 'Start AR' : hasVR ? 'Start VR' : 'XR not supported', hasAR || hasVR);
      return { hasAR, hasVR };
    };

    let support:{hasAR:boolean;hasVR:boolean} = {hasAR:false,hasVR:false};
    trySupport().then(s => support = s);

    btn.onclick = async () => {
      const xr = (navigator as any).xr as XRSystem | undefined;
      if (!xr) return;

      const mode = support.hasAR ? 'immersive-ar' : support.hasVR ? 'immersive-vr' : null;
      if (!mode) return;

      const session = await xr.requestSession(mode as any, wantFeatures as any);
      await (this.renderer.xr as any).setSession(session);

      // visible hand meshes for debugging (only after session to ensure joints stream)
      const { XRHandModelFactory } = await import('three/examples/jsm/webxr/XRHandModelFactory.js');
      const handFactory = new XRHandModelFactory();
      const hands = [this.renderer.xr.getHand(0), this.renderer.xr.getHand(1)];
      hands.forEach(h => {
        this.scene.add(h);
        h.add(handFactory.createHandModel(h, 'mesh'));
      });
    };
  }
}
