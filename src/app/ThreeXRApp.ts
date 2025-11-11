import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

export type XRFrameInfo = { frame: XRFrame | null; refSpace: XRReferenceSpace | null };

export class ThreeXRApp {
  public renderer: THREE.WebGLRenderer;
  public scene = new THREE.Scene();
  public camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
  public contentRoot = new THREE.Group();

  /** Dedicated, light DOM overlay – safer than using document.body */
  public readonly overlayRoot: HTMLDivElement;

  private onFrameCbs: Array<(info: XRFrameInfo) => void> = [];
  private refSpace: XRReferenceSpace | null = null;
  private handFactory = new XRHandModelFactory();
  private handsAdded = false;

  /** Saved render loop so we can pause/resume during typing */
  private renderLoop?: (t: number, frame?: XRFrame) => void;

  constructor() {
    // Canvas / renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');
    document.body.appendChild(this.renderer.domElement);

    // Transparent for AR passthrough
    this.scene.background = null;

    // World
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.9));
    this.scene.add(this.contentRoot);

    // Overlay root (lightweight container used by domOverlay)
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.id = 'overlay-root';
    Object.assign(this.overlayRoot.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'auto',
      contain: 'layout paint size style',
      fontFamily: 'system-ui, sans-serif',
    } as CSSStyleDeclaration);
    // Prevent XR select hijack on overlay taps
    this.overlayRoot.addEventListener('beforexrselect', (e: any) => e.preventDefault());
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
      this.ensureDebugHands(); // only visible if hand-tracking is active
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.refSpace = null;
      document.body.classList.remove('xr-overlay');
    });

    // Pre-warm OS keyboard a single time to avoid long first-open
    this.prewarmKeyboard();

    this.wireExplicitButtons();
  }

  onFrame(cb: (info: XRFrameInfo) => void) {
    this.onFrameCbs.push(cb);
  }

  start() {
    this.renderLoop = (_t: number, frame?: XRFrame) => {
      const sess = (this.renderer.xr as any).getSession?.();
      if (!sess) return; // guard if XR tears down
      const refSpace = this.refSpace ?? (this.renderer.xr as any).getReferenceSpace?.() ?? null;
      for (const cb of this.onFrameCbs) cb({ frame: frame ?? null, refSpace });
      this.renderer.render(this.scene, this.camera);
    };
    this.renderer.setAnimationLoop(this.renderLoop);
  }

  /** Pause XR draw while a DOM input has focus (prevents device-loss on some headsets). */
  pauseWhileFocused(el: HTMLElement) {
    if (!el) return;
    const pause = () => this.renderer.setAnimationLoop(null);
    const resume = () => this.renderer.setAnimationLoop(this.renderLoop ?? null);
    el.addEventListener('focus', pause);
    el.addEventListener('blur', resume);
  }

  // =============== Buttons (explicit AR/VR) ===============
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

      // AR flow (dom-overlay + optional hand-tracking)
      arBtn?.addEventListener('click', async () => {
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local-floor'] as any,
          optionalFeatures: ['dom-overlay', 'hit-test', 'hand-tracking'],
          // @ts-ignore
          domOverlay: { root: this.overlayRoot },
        };
        const session = await xr.requestSession('immersive-ar', sessionInit as any);
        await (this.renderer.xr as any).setSession(session);
      });

      // VR flow (no dom-overlay; hand-tracking optional)
      vrBtn?.addEventListener('click', async () => {
        const sessionInit: XRSessionInit = {
          requiredFeatures: ['local-floor'] as any,
          optionalFeatures: ['hand-tracking'],
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

  /** Warm up OS keyboard so first open is fast */
  private prewarmKeyboard() {
    const warm = document.createElement('input');
    warm.type = 'text';
    Object.assign(warm.style, { position: 'absolute', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(warm);
    setTimeout(() => {
      warm.focus();
      (navigator as any).virtualKeyboard?.show?.();
      setTimeout(() => warm.blur(), 50);
    }, 0);
  }
}
