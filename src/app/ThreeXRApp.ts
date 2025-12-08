import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { logError } from '../utils/errors';
import { GAUSSIAN_SPLAT } from '../config/constants';

export type XRFrameInfo = { frame: XRFrame | null; refSpace: XRReferenceSpace | null };

export class ThreeXRApp {
  public renderer: THREE.WebGLRenderer;
  public scene = new THREE.Scene();
  public camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
  public contentRoot = new THREE.Group();
  public overlayRoot: HTMLElement;
  public sparkRenderer: any; // SparkRenderer from @sparkjsdev/spark
  
  // Expose countSplatMeshesInScene for external debugging
  public countSplatMeshesInScene = this._countSplatMeshesInScene.bind(this);
  
  // Debug overlay for Spark/Splat diagnostics (optional, can be toggled)
  private sparkDebugOverlay: HTMLElement | null = null;
  private sparkDebugEnabled = false; // Can be enabled via GAUSSIAN_SPLAT.DEBUG_OVERLAY config

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
    
    // Enable max anisotropic filtering for crisp textures
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // Anisotropic filtering automatically applied to textures
    
    document.body.appendChild(this.renderer.domElement);

    this.scene.background = null;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 0.9));
    this.scene.add(this.contentRoot);

    // Initialize SparkRenderer for Gaussian Splatting
    // SparkJS requires SparkRenderer to be added to the scene for proper rendering
    this.initializeSparkRenderer();

    // Overlay root (for lightweight DOM UI if needed)
    this.overlayRoot = document.createElement('div');
    Object.assign(this.overlayRoot.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '5',
    });
    document.body.appendChild(this.overlayRoot);

    // Handle window resize with debouncing for performance
    let resizeTimeout: number | null = null;
    addEventListener('resize', () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        const width = window.innerWidth || innerWidth;
        const height = window.innerHeight || innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      }, 100);
    });

    // XR lifecycle
    this.renderer.xr.addEventListener('sessionstart', async (event: any) => {
      const session = event.session as XRSession;
      this.refSpace = (this.renderer.xr as any).getReferenceSpace?.() ?? null;
      document.body.classList.add('xr-overlay');
      this.ensureDebugHands();
      
      // XR DEBUG: Log session details
      // Note: XRSession.mode is available but TypeScript types may not include it
      const sessionMode = (session as any).mode as string | undefined;
      const mode = sessionMode === 'immersive-vr' ? 'VR' : sessionMode === 'immersive-ar' ? 'AR' : sessionMode || 'unknown';
      const refSpaceType = (this.renderer.xr as any).getReferenceSpaceType?.() || 'unknown';
      console.log(`[XRDebug] 🥽 XR Session started:`, {
        mode,
        referenceSpace: refSpaceType,
        sessionMode: sessionMode
      });
      console.log(`[XRDebug] 💡 Camera will be automatically updated by Three.js for XR mode`);
      if (this.sparkRenderer) {
        console.log(`[XRDebug] ✅ SparkRenderer is active and will use XR camera`);
      } else {
        console.warn(`[XRDebug] ⚠️ SparkRenderer not initialized - splats may not render in XR`);
      }
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.refSpace = null;
      document.body.classList.remove('xr-overlay');
      console.log(`[XRDebug] 🥽 XR Session ended - returning to desktop mode`);
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
      
      // Get the active camera (XR camera in XR mode, normal camera in desktop mode)
      // In XR mode, Three.js automatically updates this.camera to be the XR camera
      const activeCamera = this.renderer.xr.isPresenting 
        ? this.camera // Three.js already updated this.camera to XR camera
        : this.camera;
      
      // CRITICAL FIX: SparkRenderer integration pattern
      // 
      // SparkJS SparkRenderer integration (autoUpdate: true mode):
      // - SparkRenderer is added to the scene (done in initializeSparkRenderer)
      // - With autoUpdate: true, SparkRenderer handles its own update cycle automatically
      // - However, we may still need to ensure it has the correct camera reference
      // 
      // IMPORTANT: With autoUpdate: true, SparkRenderer should automatically:
      // 1. Discover SplatMesh objects in the scene
      // 2. Update every frame with the current camera
      // 3. Render splats during the main render pass
      // 
      // For XR: activeCamera is automatically the XR camera when in XR mode
      // For desktop: activeCamera is the normal PerspectiveCamera
      // 
      // Render order with autoUpdate: true:
      // 1. Update SparkRenderer BEFORE render (if manual update still needed)
      // 2. Call renderer.render() - SparkRenderer will render splats automatically during this call
      if (!this.sparkRenderer) {
        // Only log once to avoid spam
        if (!(this as any)._sparkRendererWarningLogged) {
          console.warn('[ThreeXRApp] ⚠️ SparkRenderer not initialized - Gaussian Splats will not render');
          (this as any)._sparkRendererWarningLogged = true;
        }
      }
      
      // CRITICAL: With autoUpdate: true, SparkRenderer should handle its own updates
      // However, we may still need to ensure it has the correct camera reference
      // Some SparkRenderer implementations need manual update even with autoUpdate: true
      // Try both patterns: update before render (prepares state) and let autoUpdate handle rendering
      if (this.sparkRenderer) {
        // Check if SparkRenderer has autoUpdate enabled
        const hasAutoUpdate = (this.sparkRenderer as any).autoUpdate !== false;
        
        if (hasAutoUpdate && this.sparkRenderer.update) {
          // With autoUpdate: true, we may still need to pass camera for XR support
          // Update BEFORE render to ensure SparkRenderer has correct camera state
          this.sparkRenderer.update({ 
            scene: this.scene,
            camera: activeCamera
          });
        } else if (!hasAutoUpdate && this.sparkRenderer.update) {
          // Manual update mode - must call update
          this.sparkRenderer.update({ 
            scene: this.scene,
            camera: activeCamera
          });
        }
      }
      
      // Render the scene with the camera (Three.js handles XR camera updates automatically)
      // SparkRenderer (if autoUpdate: true) will automatically render splats during this call
      // OR if manual update, it will render based on the update() call above
      this.renderer.render(this.scene, activeCamera);
      
      // DEBUG: Periodically log SplatMesh count (throttled to avoid spam)
      if (this.sparkRenderer && !(this as any)._lastSplatMeshCheck) {
        (this as any)._lastSplatMeshCheck = performance.now();
      }
      if (this.sparkRenderer && (this as any)._lastSplatMeshCheck && 
          performance.now() - (this as any)._lastSplatMeshCheck > 5000) {
        const splatMeshInfo = this._countSplatMeshesInScene();
        if (splatMeshInfo.count > 0) {
          console.log(`[SparkDebug] SplatMesh count in scene: ${splatMeshInfo.count}`);
          splatMeshInfo.details.forEach((detail, i) => {
            console.log(`[SparkDebug]   SplatMesh ${i + 1}: ${detail.path} (url: ${detail.url})`);
          });
          console.log(`[SparkDebug] 💡 If count > 0 but splats don't render, check SparkRenderer.update() and camera`);
        } else {
          console.log(`[SparkDebug] ⚠️ No SplatMesh instances found in scene - splats may not be loaded yet`);
        }
        (this as any)._lastSplatMeshCheck = performance.now();
      }
    };
    this.renderer.setAnimationLoop(this.loopFn);
  }

  /**
   * Debug helper: Count SplatMesh instances in the scene.
   * This helps verify that SplatMesh objects are properly added and discoverable by SparkRenderer.
   * 
   * Returns: { count: number, details: Array<{path: string, url?: string}> }
   */
  private _countSplatMeshesInScene(): { count: number; details: Array<{path: string; url?: string}> } {
    const details: Array<{path: string; url?: string}> = [];
    let count = 0;
    
    this.scene.traverse((object: any) => {
      // Check if object is a SplatMesh (SparkJS SplatMesh instances)
      // SplatMesh typically has properties like 'url', 'initialized', or is an instance of SplatMesh class
      const isSplatMesh = object && (
        object.constructor?.name === 'SplatMesh' ||
        (object.url && object.initialized !== undefined) ||
        object.type === 'SplatMesh' ||
        (object.isSplatMesh === true) // Some libraries use this flag
      );
      
      if (isSplatMesh) {
        count++;
        // Build path for debugging
        const path: string[] = [];
        let current: any = object;
        while (current && current !== this.scene) {
          path.unshift(current.name || current.type || 'unnamed');
          current = current.parent;
        }
        details.push({
          path: path.join(' -> '),
          url: object.url || 'unknown'
        });
      }
    });
    
    return { count, details };
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

    init().catch((error) => logError(error, 'ThreeXRApp.wireExplicitButtons'));
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

  /**
   * Initialize SparkRenderer for Gaussian Splatting support.
   * SparkJS requires SparkRenderer to be added to the scene for proper rendering.
   * This is done lazily to handle cases where the library might not be installed.
   * 
   * IMPORTANT: If you see axes but no splat content:
   * 1. Check that SparkRenderer initialized (look for success message in console)
   * 2. Verify camera is passed to sparkRenderer.update() in render loop
   * 3. Ensure SplatMesh objects are added to the scene
   * 4. Check that the .ply file is a valid Gaussian splat format
   */
  private async initializeSparkRenderer() {
    console.log('[ThreeXRApp] 🔄 Initializing SparkRenderer for Gaussian Splatting...');
    try {
      // @ts-ignore - Library may not be installed yet
      const module = await import('@sparkjsdev/spark');
      const SparkRenderer = module.SparkRenderer;
      
      if (!SparkRenderer) {
        console.error('[ThreeXRApp] ❌ SparkRenderer not found in @sparkjsdev/spark - Gaussian Splats will not render');
        console.error('[ThreeXRApp] 💡 Install with: npm install @sparkjsdev/spark');
        return;
      }

      console.log('[ThreeXRApp] ✅ SparkRenderer class found, creating instance...');
      // Create SparkRenderer instance
      // SparkJS SparkRenderer options:
      // - renderer: THREE.WebGLRenderer (required)
      // - autoUpdate: boolean (optional) - if true, SparkRenderer updates automatically
      // 
      // CRITICAL FIX: Try autoUpdate: true first - SparkRenderer may need to handle
      // its own update cycle to properly discover and render SplatMesh objects.
      // If autoUpdate works, it will automatically update every frame with the correct camera.
      try {
        // Try with autoUpdate: true - SparkRenderer will handle updates automatically
        // This is the recommended pattern for SparkJS integration
        this.sparkRenderer = new SparkRenderer({ 
          renderer: this.renderer,
          autoUpdate: true
        });
        console.log('[ThreeXRApp] ✅ SparkRenderer created with autoUpdate: true (automatic updates)');
        console.log('[ThreeXRApp] 💡 SparkRenderer will automatically update every frame and discover SplatMesh objects');
      } catch (e: any) {
        // If autoUpdate option causes error, try without it (defaults may vary)
        try {
          this.sparkRenderer = new SparkRenderer({ renderer: this.renderer });
          console.log('[ThreeXRApp] ✅ SparkRenderer created (using default options - may auto-update)');
        } catch (e2: any) {
          console.error('[ThreeXRApp] ❌ Failed to create SparkRenderer:', e2);
          throw e2;
        }
      }
      
      // Add SparkRenderer to the scene (required for proper rendering)
      // SparkRenderer must be in the scene graph for it to discover and render SplatMesh objects
      this.scene.add(this.sparkRenderer);
      
      console.log('[ThreeXRApp] ✅ SparkRenderer initialized successfully and added to scene');
      console.log('[ThreeXRApp] 💡 SparkRenderer will be updated every frame with camera info for XR support');
      console.log('[ThreeXRApp] 💡 SparkRenderer will automatically discover and render SplatMesh objects in the scene');
      
      // Initialize debug overlay if enabled via config
      if (GAUSSIAN_SPLAT.DEBUG_OVERLAY) {
        this.sparkDebugEnabled = true;
        this.initializeSparkDebugOverlay();
      }
    } catch (e: any) {
      // Library not installed or failed to load - this is OK, app will still work
      // Gaussian Splats just won't render until the library is installed
      console.error('[ThreeXRApp] ❌ Failed to initialize SparkRenderer', e);
      console.error('[ThreeXRApp] 💡 Install with: npm install @sparkjsdev/spark');
      console.warn('[ThreeXRApp] App will continue without Gaussian Splat support');
    }
  }

  /**
   * Initialize optional debug overlay for Spark/Splat diagnostics.
   * Shows SplatMesh count, SparkRenderer status, and camera mode.
   * Can be toggled by setting sparkDebugEnabled = true in constructor.
   */
  private initializeSparkDebugOverlay() {
    if (this.sparkDebugOverlay) return;
    
    this.sparkDebugOverlay = document.createElement('div');
    Object.assign(this.sparkDebugOverlay.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      background: 'rgba(0, 0, 0, 0.7)',
      color: '#0f0',
      padding: '10px',
      fontFamily: 'monospace',
      fontSize: '12px',
      zIndex: '1000',
      pointerEvents: 'none',
      borderRadius: '4px',
      minWidth: '250px'
    });
    this.sparkDebugOverlay.textContent = 'Spark Debug: Initializing...';
    document.body.appendChild(this.sparkDebugOverlay);
    
    // Update debug overlay periodically
    let lastUpdate = 0;
    const updateDebug = () => {
      if (!this.sparkDebugOverlay) return;
      
      const now = performance.now();
      if (now - lastUpdate < 500) {
        requestAnimationFrame(updateDebug);
        return;
      }
      lastUpdate = now;
      
      const splatMeshInfo = this._countSplatMeshesInScene();
      const xrMode = this.renderer.xr.isPresenting ? 'XR' : 'Desktop';
      const sparkStatus = this.sparkRenderer ? 'Active' : 'Not Initialized';
      
      this.sparkDebugOverlay.textContent = [
        '=== Spark Debug ===',
        `Mode: ${xrMode}`,
        `SparkRenderer: ${sparkStatus}`,
        `SplatMesh Count: ${splatMeshInfo.count}`,
        splatMeshInfo.count > 0 ? `✅ Splats found` : `⚠️ No splats`,
        '',
        'Update: After render'
      ].join('\n');
      
      requestAnimationFrame(updateDebug);
    };
    updateDebug();
  }
}
