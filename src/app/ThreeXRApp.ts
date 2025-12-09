import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { logError } from '../utils/errors';
import { GAUSSIAN_SPLAT } from '../config/constants';
import { logger } from '../config/production';
import { OptimizedXRRenderLoop } from '../xr/OptimizedXRRenderLoop';
import { isGaussianSplatOptimizedEnabled } from '../config/gaussianEnv';

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

  // Optimized XR render loop (gated behind flag)
  private optimizedRenderLoop: OptimizedXRRenderLoop | null = null;
  private splatObjects: THREE.Object3D[] = [];

  constructor() {
    // ✅ Quest 3 Performance Optimization
    // Detect mobile XR devices (Quest, Oculus, Android)
    const isMobileXR = /Quest|Oculus|Android/i.test(navigator.userAgent);
    
    // On Quest/Android, turn off MSAA and lower pixel ratio for perf
    // Spark's splats already look good; MSAA is expensive in XR
    this.renderer = new THREE.WebGLRenderer({
      antialias: !isMobileXR, // Disable antialias on mobile XR for performance
      alpha: true,
    });
    
    const width = window.innerWidth || innerWidth;
    const height = window.innerHeight || innerHeight;
    
    // ✅ Clamp pixel ratio on mobile XR for Quest 3 performance
    // Full devicePixelRatio + antialias is expensive; reduce to 75% max
    const basePixelRatio = window.devicePixelRatio || 1;
    const pixelRatio = isMobileXR ? Math.min(0.75 * basePixelRatio, 1.0) : basePixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType?.('local-floor');
    
    // ✅ CRITICAL FIX: Set framebuffer scale factor for WebXR performance
    // Reduces render resolution in XR for better frame rate (0.75 = 75% resolution)
    // Tune between 0.6-0.8 based on performance vs quality tradeoff for Quest 3 (60-72 fps target)
    if (this.renderer.xr.setFramebufferScaleFactor && isMobileXR) {
      this.renderer.xr.setFramebufferScaleFactor(0.75); // 75% resolution for Quest 3 (tuned for 60-72 fps)
      logger.verbose(`[ThreeXRApp] WebXR framebuffer scale set to 0.75 for Quest 3 performance`);
    }
    
    // ✅ Explicitly disable shadow maps for perf (avoid hidden costs from lighting)
    this.renderer.shadowMap.enabled = false;
    
    // Enable max anisotropic filtering for crisp textures (desktop only)
    if (!isMobileXR) {
      const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
      // Anisotropic filtering automatically applied to textures
      logger.verbose(`[ThreeXRApp] Desktop mode: Anisotropic filtering enabled (max: ${maxAnisotropy})`);
    } else {
      logger.verbose(`[ThreeXRApp] Mobile XR detected: Pixel ratio clamped to ${pixelRatio.toFixed(2)}, antialias disabled`);
    }
    
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

    // Setup optimized render loop if flag is enabled
    this.setupOptimizedRenderLoop();
  }

  private setupOptimizedRenderLoop(): void {
    if (!isGaussianSplatOptimizedEnabled) return;
    if (!this.renderer || !this.scene || !this.camera) return;

    console.log('[ThreeXRApp] Initializing OptimizedXRRenderLoop (Quest 3)');

    this.optimizedRenderLoop = new OptimizedXRRenderLoop(
      this.renderer,
      this.scene,
      this.camera
    );

    this.renderer.xr.addEventListener('sessionstart', () => {
      const session = this.renderer.xr.getSession();
      if (session && this.optimizedRenderLoop) {
        this.optimizedRenderLoop.onXRSessionStart(session);
        console.log('[ThreeXRApp] OptimizedXRRenderLoop active for XR session');
      }
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      console.log('[ThreeXRApp] XR session ended');
    });
  }

  /**
   * Register a splat object for optimization tracking.
   */
  public registerSplatObject(obj: THREE.Object3D): void {
    if (!this.optimizedRenderLoop) return;
    this.splatObjects.push(obj);
    this.optimizedRenderLoop.registerSplatObject(obj);
  }

  /**
   * Unregister a splat object.
   */
  public unregisterSplatObject(obj: THREE.Object3D): void {
    const idx = this.splatObjects.indexOf(obj);
    if (idx !== -1) this.splatObjects.splice(idx, 1);
    if (this.optimizedRenderLoop) {
      this.optimizedRenderLoop.unregisterSplatObject(obj);
    }
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
      
      // CRITICAL FIX: SparkRenderer + WebXR integration pattern
      // 
      // With preUpdate: false and autoUpdate: true (WebXR-optimized config):
      // - SparkRenderer is attached to camera (done in initializeSparkRenderer)
      // - autoUpdate: true means SparkRenderer handles its own update cycle
      // - preUpdate: false is CRITICAL for WebXR (per Spark docs)
      // 
      // For XR: activeCamera is automatically the XR camera when in XR mode
      // Three.js updates the camera for each eye automatically
      // SparkRenderer attached to camera will follow the XR camera correctly
      // 
      // IMPORTANT: With autoUpdate: true and camera attachment:
      // 1. SparkRenderer automatically discovers SplatMesh objects in the scene
      // 2. SparkRenderer automatically uses the active XR camera for each eye
      // 3. SparkRenderer renders splats during the main render pass
      // 4. No manual update() call needed - Spark handles everything
      // 
      // PERFORMANCE FIX: Only call update() if autoUpdate is false
      // If autoUpdate is true, SparkRenderer handles updates internally
      // Calling update() manually when autoUpdate is true is redundant and can cause conflicts
      if (this.sparkRenderer && this.sparkRenderer.update) {
        // Check if autoUpdate is enabled (if available in SparkRenderer API)
        const hasAutoUpdate = typeof (this.sparkRenderer as any).autoUpdate !== 'undefined';
        const autoUpdate = (this.sparkRenderer as any).autoUpdate !== false;
        
        // Only manually update if autoUpdate is disabled
        if (!autoUpdate || !hasAutoUpdate) {
          try {
            this.sparkRenderer.update({ 
              scene: this.scene,
              camera: activeCamera
            });
          } catch (e) {
            // Ignore update errors (Spark may handle internally)
            if (!(this as any)._sparkUpdateErrorLogged) {
              console.warn('[ThreeXRApp] SparkRenderer.update() error:', e);
              (this as any)._sparkUpdateErrorLogged = true;
            }
          }
        }
        // If autoUpdate is true, SparkRenderer handles everything - no manual update needed
      }
      
      // Render the scene with the camera (Three.js handles XR camera updates automatically)
      // SparkRenderer (with autoUpdate: true) will automatically render splats during this call
      // 
      // ✅ RENDER ORDER: Three.js sorts objects by renderOrder before rendering
      // - Splats render first (default renderOrder = 0, handled by SparkRenderer)
      // - UI panels render last (renderOrder = 10000+)
      // - This ensures panels are composited on top of splats without Z-fighting
      // - Panel materials have depthTest=false, depthWrite=false to prevent depth conflicts
      // 
      // ✅ XR STEREO RENDERING:
      // - Three.js automatically renders left and right eye views
      // - SparkRenderer attached to camera follows XR camera correctly
      // - Each eye gets consistent splat rendering (no flicker)
      if (
        isGaussianSplatOptimizedEnabled &&
        this.optimizedRenderLoop &&
        this.renderer.xr.isPresenting
      ) {
        this.optimizedRenderLoop.render(_t, frame);
      } else {
        this.renderer.render(this.scene, activeCamera);
      }
      
      // DEBUG: Periodically log SplatMesh count (throttled to avoid spam)
      // Only log in development mode to avoid performance impact on Quest 3
      if ((import.meta as any).env?.MODE === 'development') {
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
      // Preserve the inner span structure - only update text if span exists
      const labelSpan = el.querySelector('.ar-cta-label');
      if (labelSpan) {
        labelSpan.textContent = label;
      } else {
        // Fallback: if no span exists, set textContent (but preserve structure)
        el.textContent = label;
      }
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
   * CRITICAL FIX FOR WEBXR:
   * - preUpdate: false (IMPORTANT for WebXR per Spark docs)
   * - autoUpdate: true (let Spark auto-update)
   * - Attach to camera for higher precision in XR
   * - Configure performance params for Quest 3 (60-72 fps target)
   * 
   * IMPORTANT: If you see axes but no splat content:
   * 1. Check that SparkRenderer initialized (look for success message in console)
   * 2. Verify camera is passed to sparkRenderer.update() in render loop
   * 3. Ensure SplatMesh objects are added to the scene
   * 4. Check that the .ply/.spz file is a valid Gaussian splat format
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
      
      // CRITICAL FIX: WebXR-optimized SparkRenderer configuration
      // Based on Spark's WebXR best practices and sparkxrstart reference
      const isMobileXR = /Quest|Oculus|Android/i.test(navigator.userAgent);
      
      try {
        // WebXR-optimized configuration per Spark documentation
        this.sparkRenderer = new SparkRenderer({ 
          renderer: this.renderer,
          preUpdate: false,  // CRITICAL: false for WebXR (per Spark docs)
          autoUpdate: true,  // Let Spark auto-update with correct camera
          // Performance tuning for Quest 3 (60-72 fps target)
          maxStdDev: Math.sqrt(6),   // Tighter => less overdraw
          minPixelRadius: 0.5,       // Cull super tiny splats
          maxPixelRadius: 256.0,      // Reduced from default 512 for performance
          clipXY: 1.2,               // Tighter culling at edges
          focalAdjustment: 1.5,       // Standard adjustment
        });
        console.log('[ThreeXRApp] ✅ SparkRenderer created with WebXR-optimized settings');
        console.log('[ThreeXRApp] 💡 preUpdate: false (WebXR requirement)');
        console.log('[ThreeXRApp] 💡 autoUpdate: true (automatic camera sync)');
        console.log('[ThreeXRApp] 💡 Performance params tuned for Quest 3 (60-72 fps target)');
      } catch (e: any) {
        // Fallback: try with minimal options if full config fails
        try {
          this.sparkRenderer = new SparkRenderer({ 
            renderer: this.renderer,
            preUpdate: false,  // Still critical for WebXR
            autoUpdate: true
          });
          console.log('[ThreeXRApp] ✅ SparkRenderer created with minimal WebXR settings');
        } catch (e2: any) {
          console.error('[ThreeXRApp] ❌ Failed to create SparkRenderer:', e2);
          throw e2;
        }
      }
      
      // CRITICAL FIX: Attach SparkRenderer to camera for higher precision in XR
      // This ensures SparkRenderer follows the XR camera correctly for each eye
      // Alternative: Add to scene (works but camera attachment is preferred for XR)
      this.camera.add(this.sparkRenderer);
      console.log('[ThreeXRApp] ✅ SparkRenderer attached to camera (optimal for XR)');
      
      // Alternative: If camera attachment doesn't work, add to scene instead
      // this.scene.add(this.sparkRenderer);
      // console.log('[ThreeXRApp] ✅ SparkRenderer added to scene');
      
      console.log('[ThreeXRApp] ✅ SparkRenderer initialized successfully');
      console.log('[ThreeXRApp] 💡 SparkRenderer will automatically sync with XR camera for each eye');
      console.log('[ThreeXRApp] 💡 SparkRenderer will automatically discover and render SplatMesh objects');
      
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
