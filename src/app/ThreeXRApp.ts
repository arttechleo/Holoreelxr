import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

export type XRFrameInfo = { frame: XRFrame | null; refSpace: XRReferenceSpace | null };

export class ThreeXRApp {
  public renderer: THREE.WebGLRenderer;
  public scene = new THREE.Scene();
  public camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
  public contentRoot = new THREE.Group();
  public overlayRoot: HTMLElement;

  private onFrameCbs: Array<(info: XRFrameInfo) => void> = [];
  private refSpace: XRReferenceSpace | null = null;
  private handFactory = new XRHandModelFactory();
  private handsAdded = false;

  private paused = false;
  private loopFn?: (t: number, frame?: XRFrame) => void;
  private onPauseCbs: Array<() => void> = [];
  private onResumeCbs: Array<() => void> = [];

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');
    document.body.appendChild(this.renderer.domElement);

    this.scene.background = null;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.9));
    this.scene.add(this.contentRoot);

    // Overlay root (for lightweight DOM UI if needed)
    this.overlayRoot = document.createElement('div');
    Object.assign(this.overlayRoot.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '5',
    });
    document.body.appendChild(this.overlayRoot);

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // XR lifecycle
    this.renderer.xr.addEventListener('sessionstart', async () => {
      this.refSpace = (this.renderer.xr as any).getReferenceSpace?.() ?? null;
      document.body.classList.add('xr-overlay');
      this.ensureDebugHands();
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.refSpace = null;
      document.body.classList.remove('xr-overlay');
    });

    // Pause / resume on tab switch
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pause();
      else this.resume();
    });
    window.addEventListener('pagehide', () => this.pause());
    window.addEventListener('pageshow', () => this.resume());
    window.addEventListener('blur', () => this.pause());
    window.addEventListener('focus', () => this.resume());

    this.wireExplicitButtons();
  }

  onFrame(cb: (info: XRFrameInfo) => void) {
    this.onFrameCbs.push(cb);
  }
  onPause(cb: () => void) {
    this.onPauseCbs.push(cb);
  }
  onResume(cb: () => void) {
    this.onResumeCbs.push(cb);
  }

  start() {
    this.loopFn = (_t: number, frame?: XRFrame) => {
      const refSpace = this.refSpace ?? (this.renderer.xr as any).getReferenceSpace?.();
      for (const cb of this.onFrameCbs) cb({ frame: frame ?? null, refSpace });
      this.renderer.render(this.scene, this.camera);
    };
    this.renderer.setAnimationLoop(this.loopFn);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.renderer.setAnimationLoop(null);
    for (const f of this.onPauseCbs) f();
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.loopFn) this.renderer.setAnimationLoop(this.loopFn);
    for (const f of this.onResumeCbs) f();
  }

  pauseWhileFocused(el: HTMLElement) {
    el.addEventListener('focus', () => this.pause());
    el.addEventListener('blur', () => this.resume());
  }

  private wireExplicitButtons() {
    const arBtn = document.getElementById('enter-ar') as HTMLButtonElement | null;
    const vrBtn = document.getElementById('enter-vr') as HTMLButtonElement | null;

    const setLabel = (el: HTMLButtonElement | null, label: string, enabled: boolean) => {
      if (!el) return;
      el.textContent = label;
      el.disabled = !enabled;
    };

    const init = async () => {
      const xr = (navigator as any).xr as XRSystem | undefined;
      if (!xr) {
        setLabel(arBtn, 'AR not available', false);
        setLabel(vrBtn, 'VR not available', false);
        return;
      }
      const hasAR = await xr.isSessionSupported('immersive-ar').catch(() => false);
      const hasVR = await xr.isSessionSupported('immersive-vr').catch(() => false);
      setLabel(arBtn, hasAR ? 'Enter AR' : 'AR not supported', !!hasAR);
      setLabel(vrBtn, hasVR ? 'Enter VR' : 'VR not supported', !!hasVR);

      arBtn?.addEventListener('click', async () => {
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['dom-overlay', 'hit-test', 'hand-tracking'],
          // @ts-ignore
          domOverlay: { root: document.body },
        };
        const session = await xr.requestSession('immersive-ar', sessionInit as any);
        await (this.renderer.xr as any).setSession(session);
      });

      vrBtn?.addEventListener('click', async () => {
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['hand-tracking'],
        };
        const session = await xr.requestSession('immersive-vr', sessionInit as any);
        await (this.renderer.xr as any).setSession(session);
      });
    };

    init().catch(console.error);
  }

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
