// src/controls/FeedControls.ts
import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { ThreeXRApp } from '../app/ThreeXRApp';
import { FeedStore } from '../feed/FeedStore';
import ReactionHudManager from '../ui/ReactionHudManager';
import { TikTokFeedUI } from '../ui/TikTokFeedUI';
import { GestureTutorial } from '../ui/GestureTutorial';
import { ParticleSystem } from '../effects/ParticleSystem';
import { XRAuthPanel } from '../ui/XRAuthPanel';
import { XRMusicPanel } from '../ui/XRMusicPanel';
import { CONTROLS, TRANSFORM, REACTIONS, HUD } from '../config/constants';
import { logError } from '../utils/errors';

export class FeedControls {
  // ----- feed scroll -----
  private lastPinchY: number | null = null;
  private filtPinchY: number | null = null;
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private pinchStartAt: number | null = null;
  private scrollArmed = false;
  private scrollDisarmedThisPinch = false;

  // Scroll control constants
  private readonly SCROLL_MIN_HOLD_MS = CONTROLS.SCROLL_MIN_HOLD_MS;
  private readonly SCROLL_DISP = CONTROLS.SCROLL_DISPLACEMENT;
  private readonly SCROLL_COOLDOWN_MS = CONTROLS.SCROLL_COOLDOWN_MS;
  private readonly SCROLL_VEL_MIN = CONTROLS.SCROLL_MIN_VELOCITY;
  private readonly SCROLL_IN_AIR_DIST = CONTROLS.SCROLL_IN_AIR_DISTANCE;
  private readonly SCROLL_START_FAR = CONTROLS.SCROLL_START_DISTANCE;
  private readonly LPF_SCROLL_ALPHA = CONTROLS.SCROLL_LPF_ALPHA;

  // transform / grab
  private twoHandActive = false;
  private baseDist = 0;
  private baseScale = 1;
  private filtDist = 0;
  private readonly LPF_ALPHA = TRANSFORM.TWO_HAND_LPF_ALPHA;
  private readonly SCALE_GAIN = TRANSFORM.SCALE_GAIN;
  private readonly SCALE_DEADBAND = TRANSFORM.SCALE_DEADBAND;
  // Scale limits removed - allow unlimited scaling
  private rotTarget = 0;
  private rotVel = 0;
  private readonly ROT_GAIN = TRANSFORM.ROTATION_GAIN;
  private readonly ROT_DEADZONE = TRANSFORM.ROTATION_DEADZONE_RAD;
  private readonly ROT_MAX_DELTA = TRANSFORM.ROTATION_MAX_DELTA_RAD;
  private readonly ROT_SMOOTH_TIME = TRANSFORM.ROTATION_SMOOTH_TIME;
  private readonly ROT_MAX_SPEED = TRANSFORM.ROTATION_MAX_SPEED_RAD;
  private LStart = new THREE.Vector3();
  private RStart = new THREE.Vector3();
  private lastL = new THREE.Vector3();
  private lastR = new THREE.Vector3();
  private readonly MOVE_EPS = TRANSFORM.MIN_MOVEMENT_FOR_ROTATION;
  private grabbing = false;
  private grabSide: 'left' | 'right' | null = null;
  private grabOffset = new THREE.Vector3();
  private grabPending = false;
  private grabPendingSide: 'left' | 'right' | null = null;
  private grabPendingStartY: number | null = null;
  private grabTimer: number | null = null;
  private readonly HOLD_MS = TRANSFORM.GRAB_HOLD_MS;
  private readonly PENDING_CANCEL_MOVE = TRANSFORM.GRAB_CANCEL_MOVEMENT;
  private readonly INSTANT_GRAB_DIST = TRANSFORM.INSTANT_GRAB_DISTANCE;

  // rays (visual helpers only; kept off while UI is hit)
  private rayGroup = new THREE.Group();
  private leftRay?: THREE.Line;
  private rightRay?: THREE.Line;
  private rayMat = new THREE.LineDashedMaterial({
    color: 0xffffff,
    dashSize: 0.03,
    gapSize: 0.02,
    transparent: true,
    opacity: 0.9,
    depthTest: false,   // ✅ valid
    depthWrite: false,  // ✅ valid
  });
  
  // Rubber band scroll line (elastic connection to object) - DOTTED
  private scrollRay?: THREE.Line;
  private scrollRayMat = new THREE.LineDashedMaterial({
    color: 0x88ff88,
    transparent: true,
    opacity: 0.6,
    dashSize: 0.02,
    gapSize: 0.015,
    depthTest: false,
    depthWrite: false,
  });

  // reaction throttles (incl. repost – fixes spam)
  private lastLikeAt = 0;
  private lastHeartAt = 0;
  private lastRepostAt = 0;
  private readonly REACT_COOLDOWN_MS = REACTIONS.COOLDOWN_MS;

  // UI dwell assist (camera→index finger)
  private readonly DWELL_MS = HUD.DWELL_TIME_MS;
  private uiHoverKind: string | null = null;
  private uiHoverBeganAt = 0;
  private uiLastY: number | null = null;

  private hudMgr: ReactionHudManager;
  private selectBoundForSession: XRSession | null = null;
  
  // Gesture state tracking to prevent loops
  private gestureTriggered = new Map<string, boolean>();
  private gestureCooldown = new Map<string, number>();
  private readonly GESTURE_COOLDOWN_MS = 1000; // 1 second cooldown between same gesture - REDUCED for better responsiveness
  
  // 🎬 TikTok-style UI
  private feedUI: TikTokFeedUI;
  
  // ✨ Particle system for reactions
  private particleSystem: ParticleSystem;
  
  // 🎓 Gesture tutorial
  private tutorial: GestureTutorial;
  private showTutorialOnStart = true;

  // ---- anti-burst (close-hands) gating ----
  private readonly CLUSTER_DIST = REACTIONS.CLUSTER_DISTANCE;
  private readonly CLUSTER_Y_OFFSET = REACTIONS.CLUSTER_Y_OFFSET;
  private readonly CLUSTER_COOLDOWN_MS = REACTIONS.CLUSTER_COOLDOWN_MS;
  private readonly GESTURE_HOLD_MS = REACTIONS.GESTURE_STABLE_MS;
  private clusterCooldownUntil = 0;
  private lastStableCheckAt = 0;
  private lastStableKind: 'like' | 'heart' | 'repost' | null = null;

  private onboardingTutorial: any = null; // Reference to onboarding tutorial

  constructor(private app: ThreeXRApp, private hands: HandEngine, private store: FeedStore) {
    this.app.scene.add(this.rayGroup);
    this.initRay('left');
    this.initRay('right');
    this.setRayVisible('left', false);
    this.setRayVisible('right', false);
    
    // Initialize scroll rubber band ray
    this.initScrollRay();
    
    // 🎬 TikTok-style feed UI
    this.feedUI = new TikTokFeedUI();
    this.app.scene.add(this.feedUI.getGroup());
    
    // ✨ Particle system
    this.particleSystem = new ParticleSystem(this.app.scene);
    
    // 🎓 Gesture tutorial
    this.tutorial = new GestureTutorial();
    this.app.scene.add(this.tutorial.getGroup());

    this.hudMgr = new ReactionHudManager(this.app.scene, this.app.camera, () =>
      this.store.getObjectWorldPos()
    );
    this.hudMgr.setIcons('/assets/ui/heart.png', '/assets/ui/like.png', '/assets/ui/repost.png');

    // Disable camera overlay mode - use object-relative positioning (visible in MR)
    this.hudMgr.setCameraOverlayMode(false);

    // Place HUD to the left of object (vertical stack, no comments panel) - not used in overlay mode
    (this.hudMgr as any).setOffsets?.(
      new THREE.Vector3(-0.35, 0.0, 0.0), // icons - left side, vertically stacked
      new THREE.Vector3(0.0, 0.0, 0.0)    // comments panel removed
    );

    this.hudMgr.showFor(this.currentModelKey());

    // pinch lifecycle
    this.hands.on('leftpinchstart', () => this.onPinchStart('left'));
    this.hands.on('rightpinchstart', () => this.onPinchStart('right'));
    this.hands.on('leftpinchend', () => this.onPinchEnd('left'));
    this.hands.on('rightpinchend', () => this.onPinchEnd('right'));

    // Like gesture - thumbs up
    this.hands.on('thumbsupstart', (detail?: any) => {
      try {
        // CRITICAL: Only block if tutorial is active AND not on like step
        // After tutorial completion, FeedControls handles everything
        if (this.isTutorialActive()) {
          const tutorial = this.onboardingTutorial as any;
          const currentGesture = tutorial.getCurrentGesture?.();
          if (currentGesture !== 'thumbsup') {
            // Tutorial is active but not on like step - disable gesture
            return;
          }
        }
        
        if (!this.canTriggerGesture('thumbsup')) return;
        if (!this.acceptGesture('like')) return;
        const now = performance.now();
        if (now - this.lastLikeAt < this.REACT_COOLDOWN_MS) return;
        this.lastLikeAt = now;
        
        const side = detail?.side || 'right';
        const thumb = this.hands.thumbTip(side) || this.hands.thumbTip(side === 'left' ? 'right' : 'left');
        if (thumb) {
          // Show only 1 emoji instead of array
          this.particleSystem.emit('like', thumb, 1);
        }
        
        this.store.likeCurrent();
        this.hudMgr.bump(this.currentModelKey(), 'like');
        this.store.notify('👍 Liked!');
        
        this.markGestureTriggered('thumbsup');
        
        // Complete tutorial step if active
        if (this.tutorial && this.tutorial.getCurrentGesture() === 'thumbs_up') {
          this.tutorial.completeCurrentLesson();
        }
      } catch (error) {
        logError(error, 'FeedControls.thumbsupstart');
      }
    });
    
    // Heart gesture - both hands together
    this.hands.on('heartstart', () => {
      try {
        // CRITICAL: Only block if tutorial is active AND not on heart step
        // After tutorial completion, FeedControls handles everything
        if (this.isTutorialActive()) {
          const tutorial = this.onboardingTutorial as any;
          const currentGesture = tutorial.getCurrentGesture?.();
          if (currentGesture !== 'heart') {
            // Tutorial is active but not on heart step - disable gesture
            return;
          }
        }
        
        if (!this.canTriggerGesture('heart')) return;
        if (!this.acceptGesture('heart')) return;
        const now = performance.now();
        if (now - this.lastHeartAt < this.REACT_COOLDOWN_MS) return;
        this.lastHeartAt = now;
        
        const leftTip = this.hands.indexTip('left');
        const rightTip = this.hands.indexTip('right');
        const heartPos = leftTip && rightTip ? leftTip.clone().add(rightTip).multiplyScalar(0.5) : null;
        if (heartPos) {
          // Show only 1 emoji instead of array
          this.particleSystem.emit('heart', heartPos, 1);
        }
        
        this.store.saveCurrent();
        this.hudMgr.bump(this.currentModelKey(), 'heart');
        this.store.notify('❤️ Saved!');
        this.markGestureTriggered('heart');
        
        // Complete tutorial step if active
        if (this.tutorial && this.tutorial.getCurrentGesture() === 'heart') {
          this.tutorial.completeCurrentLesson();
        }
      } catch (error) {
        logError(error, 'FeedControls.heartstart');
      }
    });

    // Peace gesture - repost
    this.hands.on('peacestart', (detail?: any) => {
      try {
        // CRITICAL: Only block if tutorial is active AND not on peace step
        // After tutorial completion, FeedControls handles everything
        if (this.isTutorialActive()) {
          const tutorial = this.onboardingTutorial as any;
          const currentGesture = tutorial.getCurrentGesture?.();
          if (currentGesture !== 'peace') {
            // Tutorial is active but not on peace step - disable gesture
            return;
          }
        }
        
        if (!this.canTriggerGesture('peace')) return;
        if (!this.acceptGesture('repost')) return;
        const now = performance.now();
        if (now - this.lastRepostAt < this.REACT_COOLDOWN_MS) return;
        this.lastRepostAt = now;
        
        const side = detail?.side || 'right';
        const peaceHand = this.hands.indexTip(side) || this.hands.indexTip(side === 'left' ? 'right' : 'left');
        if (peaceHand) {
          // Show only 1 emoji instead of array
          this.particleSystem.emit('repost', peaceHand, 1);
        }
        
        this.store.repostCurrent();
        this.hudMgr.bump(this.currentModelKey(), 'repost');
        this.store.notify('🔁 Reposted!');
        this.markGestureTriggered('peace');
        
        // Complete tutorial step if active
        if (this.tutorial && this.tutorial.getCurrentGesture() === 'peace_sign') {
          this.tutorial.completeCurrentLesson();
        }
      } catch (error) {
        logError(error, 'FeedControls.peacestart');
      }
    });

    // WebXR select: pinch-click on UI panel
    this.installSelectHandlers();

    // frame
    let last = performance.now();
    this.app.onFrame(() => {
      const now = performance.now();
      const dt = Math.max(0, (now - last) / 1000);
      last = now;

      // dwell ray (extra help on runtimes that don’t send select)
      this.updateUiRayAndDwell(now);

      this.updateAutoAcquirePending();
      this.updateScroll(now);
      this.updateTwoHandTransform(dt);
      this.updateGrabDrag();
      this.updateGrabPendingGuard();
      this.updateRays();

      // CRITICAL: Show/hide ReactionHud based on tutorial state
      // After tutorial completion, ALWAYS show ReactionHud
      if (this.isTutorialActive()) {
        // Tutorial is active - conditionally show/hide HUD
        const tutorial = this.onboardingTutorial as any;
        const shouldShow = tutorial.shouldShowReactionHud?.();
        if (shouldShow === false) {
          // Hide ReactionHud during tutorial (except for reaction steps)
          if (this.hudMgr) {
            const hud = (this.hudMgr as any).hud;
            if (hud) {
              const anchor = (hud as any).anchor;
              if (anchor) anchor.visible = false;
            }
          }
        } else {
          // Show ReactionHud for reaction steps
          if (this.hudMgr) {
            const hud = (this.hudMgr as any).hud;
            if (hud) {
              const anchor = (hud as any).anchor;
              if (anchor) anchor.visible = true;
            }
          }
        }
      } else {
        // Tutorial NOT active (completed or doesn't exist) - ALWAYS show ReactionHud
        if (this.hudMgr) {
          const hud = (this.hudMgr as any).hud;
          if (hud) {
            const anchor = (hud as any).anchor;
            if (anchor) {
              anchor.visible = true;
              // Also ensure HUD is shown for current model
              this.hudMgr.showFor(this.currentModelKey());
            }
          }
        }
      }
      
      this.hudMgr.tick(dt);
      this.store.tick(dt);
      this.particleSystem.tick(dt);
      this.feedUI.tick(dt);

      // Get camera position once per frame for all updates (reuse vectors for performance)
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      this.app.camera.getWorldDirection(camDir);
      
      // Update TikTok UI position
      const objPos = this.store.getObjectWorldPos();
      if (objPos) {
        this.feedUI.setPosition(objPos);
        this.feedUI.lookAt(camPos);
      }
      
      // Update tutorial position
      if (this.tutorial && this.tutorial.getGroup().visible) {
        const tutorialPos = camPos.clone();
        camDir.multiplyScalar(0.8);
        tutorialPos.add(camDir);
        tutorialPos.y += 0.1;
        this.tutorial.getGroup().position.copy(tutorialPos);
        this.tutorial.lookAt(camPos);
      }
    });
  }

  // Set onboarding tutorial reference to disable controls during tutorial
  setOnboardingTutorial(tutorial: any) {
    this.onboardingTutorial = tutorial;
  }

  /**
   * Verify all features are enabled after tutorial completion.
   * Production-ready verification method.
   */
  verifyFeaturesEnabled(): boolean {
    const tutorialCompleted = this.isTutorialCompleted();
    const tutorialActive = this.isTutorialActive();
    
    console.log('[FeedControls] 🔍 Feature verification:');
    console.log(`  Tutorial completed: ${tutorialCompleted}`);
    console.log(`  Tutorial active: ${tutorialActive}`);
    console.log(`  Scroll state: ${this.scrollArmed ? 'armed' : 'disarmed'}`);
    console.log(`  Grab state: ${this.grabbing ? 'active' : 'inactive'}`);
    console.log(`  Two-hand transform: ${this.twoHandActive ? 'active' : 'inactive'}`);
    
    if (!tutorialCompleted || tutorialActive) {
      console.warn('[FeedControls] ⚠️ Tutorial state incorrect - features may be blocked');
      return false;
    }
    
    console.log('[FeedControls] ✅ All features verified and enabled');
    return true;
  }

  /**
   * Check if tutorial is completed - if so, FeedControls is the primary handler
   * CRITICAL: This is the single source of truth for tutorial completion
   */
  private isTutorialCompleted(): boolean {
    if (!this.onboardingTutorial) return true; // No tutorial = always "completed"
    const tutorial = this.onboardingTutorial as any;
    return tutorial.tutorialCompleted === true;
  }

  /**
   * Check if tutorial is active - only returns true if tutorial exists AND is not completed AND is visible
   * CRITICAL: After tutorial completion, this ALWAYS returns false
   */
  private isTutorialActive(): boolean {
    if (this.isTutorialCompleted()) return false; // Tutorial completed = never active
    if (!this.onboardingTutorial) return false; // No tutorial = not active
    const tutorial = this.onboardingTutorial as any;
    return tutorial.isTutorialActive?.() === true;
  }

  /**
   * Comprehensive state reset after tutorial completion.
   * Ensures all FeedControls features work properly after tutorial.
   * This is critical for production-ready behavior.
   */
  resetScrollState(): void {
    console.log('[FeedControls] 🔄 Comprehensive state reset after tutorial completion');
    
    // Reset scroll state
    this.lastPinchY = null;
    this.filtPinchY = null;
    this.scrollAccum = 0;
    this.scrollArmed = false;
    this.scrollDisarmedThisPinch = false;
    this.pinchStartAt = null;
    this.scrollCooldownUntil = 0;
    
    // Reset grab state
    this.grabPending = false;
    this.grabbing = false;
    this.grabSide = null;
    this.grabOffset.set(0, 0, 0);
    if (this.grabTimer != null) {
      clearTimeout(this.grabTimer);
      this.grabTimer = null;
    }
    
    // Reset two-hand transform state
    this.twoHandActive = false;
    this.baseDist = 0;
    this.baseScale = 1;
    this.filtDist = 0;
    this.rotTarget = 0;
    this.rotVel = 0;
    this.LStart.set(0, 0, 0);
    this.RStart.set(0, 0, 0);
    this.lastL.set(0, 0, 0);
    this.lastR.set(0, 0, 0);
    
    // Reset reaction gesture state
    this.lastStableKind = null;
    this.lastStableCheckAt = 0;
    this.clusterCooldownUntil = 0;
    this.gestureTriggered.clear();
    this.gestureCooldown.clear();
    
    // Reset UI state
    this.uiHoverKind = null;
    this.uiHoverBeganAt = 0;
    this.uiLastY = null;
    
    // Hide rays
    this.setRayVisible('left', false);
    this.setRayVisible('right', false);
    if (this.scrollRay) {
      this.scrollRay.visible = false;
    }
    
    console.log('[FeedControls] ✅ State reset complete - all features enabled');
    console.log('[FeedControls]   - Scroll: enabled');
    console.log('[FeedControls]   - Grab: enabled');
    console.log('[FeedControls]   - Scale/Rotate: enabled');
    console.log('[FeedControls]   - Emoji gestures: enabled');
  }

  // ---------- gesture cooldown helpers ----------
  /**
   * Check if a gesture can be triggered (not in cooldown)
   */
  private canTriggerGesture(gestureName: string): boolean {
    const now = performance.now();
    const lastTriggered = this.gestureCooldown.get(gestureName);
    
    if (lastTriggered === undefined) {
      return true; // First time, allow
    }
    
    // Check if cooldown has expired
    if (now - lastTriggered >= this.GESTURE_COOLDOWN_MS) {
      return true; // Cooldown expired, allow
    }
    
    return false; // Still in cooldown, block
  }
  
  /**
   * Mark a gesture as triggered and start cooldown
   */
  private markGestureTriggered(gestureName: string): void {
    this.gestureTriggered.set(gestureName, true);
    this.gestureCooldown.set(gestureName, performance.now());
  }

  // ---------- anti-burst helpers ----------
  /** Are hands close together and low relative to the active content? */
  private handsCloseAndLow(): boolean {
    const L = this.hands.indexTip('left');
    const R = this.hands.indexTip('right');
    if (!L || !R) return false;

    const obj = this.store.getObjectWorldPos();
    const camY = this.app.camera.position.y;
    const refY = obj ? obj.y : (camY - 0.10); // fallback if no object pos yet

    const close = L.distanceTo(R) <= this.CLUSTER_DIST;
    const low = (Math.max(L.y, R.y) - refY) <= this.CLUSTER_Y_OFFSET;
    return close && low;
  }

  /** Collapse bursts and require a short stable hold before accepting a gesture. */
  private acceptGesture(kind: 'like' | 'heart' | 'repost'): boolean {
    const now = performance.now();

    // collapse bursts that happen while hands are together & low
    if (this.handsCloseAndLow()) {
      if (now < this.clusterCooldownUntil) return false;
      this.clusterCooldownUntil = now + this.CLUSTER_COOLDOWN_MS;
    }

    // simple hold hysteresis: same kind must be "stable" for GESTURE_HOLD_MS
    if (this.lastStableKind !== kind) {
      this.lastStableKind = kind;
      this.lastStableCheckAt = now;
      return false; // first frame we see this kind -> start timing
    }
    if (now - this.lastStableCheckAt < this.GESTURE_HOLD_MS) return false;

    // passed gates
    this.lastStableCheckAt = now; // keep ticking while continuing
    return true;
  }

  // NOTE: External composer removed - was freezing XR session
  // Now using built-in ReactionHud compose mode (stays in VR)

  // ---------- Try to click HUD directly from pinch start ----------
  private tryClickHud(side: 'left' | 'right'): boolean {
    const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
    if (!from) return false;

    const panelCenter = this.hudMgr.getPanelCenterWorld();
    if (!panelCenter) return false;
    
    const dir = panelCenter.clone().sub(from).normalize();
    const ray = new THREE.Ray(from.clone(), dir);

    const hit = this.hudMgr.raycastHit(ray);
    if (!hit) return false;

    // Hide helper ray for this pinch — user clicked UI, not content
    this.setRayVisible(side, false);

    const key = this.currentModelKey();
    if (hit.kind === 'like') {
      if (!this.acceptGesture('like')) return true; // handled (swallowed)
      this.store.likeCurrent(from.clone(), side);
      this.hudMgr.bump(key, 'like');
    } else if (hit.kind === 'heart') {
      if (!this.acceptGesture('heart')) return true;
      this.store.saveCurrent(from.clone());
      this.hudMgr.bump(key, 'heart');
    } else if (hit.kind === 'repost') {
      if (!this.acceptGesture('repost')) return true;
      const now = performance.now();
      if (now - this.lastRepostAt >= this.REACT_COOLDOWN_MS) {
        this.lastRepostAt = now;
        this.store.repostCurrent(from.clone(), side);
        this.hudMgr.bump(key, 'repost');
      }
    }

    // swallow pinch so it doesn't scroll/grab this time
    this.scrollDisarmedThisPinch = true;
    this.grabPending = false;
    this.grabbing = false;
    return true;
  }

  // ---------- WebXR select → click HUD ----------
  private installSelectHandlers() {
    const xr = (this.app.renderer.xr as any);
    const ensure = () => {
      const sess = xr.getSession?.() as XRSession | undefined;
      if (!sess) return;
      if (this.selectBoundForSession === sess) return; // avoid duplicates
      this.selectBoundForSession = sess;
      const getRef = () => xr.getReferenceSpace?.() as XRReferenceSpace;

      const clickFromEvent = (ev: any) => {
        const frame: XRFrame | undefined = ev?.frame;
        const ref = getRef();
        if (!frame || !ref) return;
        const pose = frame.getPose(ev.inputSource?.targetRaySpace as XRSpace, ref);
        if (!pose) return;
        const o = new THREE.Vector3(
          pose.transform.position.x,
          pose.transform.position.y,
          pose.transform.position.z
        );
        const d = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(
            new THREE.Quaternion(
              pose.transform.orientation.x,
              pose.transform.orientation.y,
              pose.transform.orientation.z,
              pose.transform.orientation.w
            )
          )
          .normalize();
        const ray = new THREE.Ray(o, d);
        const hit = this.hudMgr.raycastHit(ray);
        if (!hit) return;

        const key = this.currentModelKey();
        if (hit.kind === 'like') {
          if (!this.acceptGesture('like')) return;
          this.store.likeCurrent();
          this.hudMgr.bump(key, 'like');
        } else if (hit.kind === 'heart') {
          if (!this.acceptGesture('heart')) return;
          this.store.saveCurrent();
          this.hudMgr.bump(key, 'heart');
        } else if (hit.kind === 'repost') {
          if (!this.acceptGesture('repost')) return;
          const now = performance.now();
          if (now - this.lastRepostAt >= this.REACT_COOLDOWN_MS) {
            this.lastRepostAt = now;
            this.store.repostCurrent();
            this.hudMgr.bump(key, 'repost');
          }
        }
      };

      sess.addEventListener('select', clickFromEvent);
    };

    ensure();
    xr.addEventListener?.('sessionstart', ensure);
  }

  // ---------- hand gesture-based UI interaction (pointing + pinch) ----------
  private updateUiRayAndDwell(now: number) {
    // Use hand gestures: point with index finger, pinch to click
    // Try right hand first, then left hand
    const rightTip = this.hands.indexTip('right');
    const leftTip = this.hands.indexTip('left');
    const tip = rightTip ?? leftTip;
    const pointingSide = rightTip ? 'right' : 'left';
    
    if (!tip) {
      this.uiHoverKind = null;
      this.uiLastY = null;
      return;
    }
    
    // Get hand direction from index finger pointing direction (hand gesture pointing)
    // Use wrist position to calculate natural pointing direction
    const wrist = this.hands.wrist?.(pointingSide);
    
    let handDir: THREE.Vector3;
    if (wrist) {
      // Pointing direction: from wrist through index finger tip (natural pointing gesture)
      handDir = tip.clone().sub(wrist).normalize();
    } else {
      // Fallback: use direction from camera to index finger (works but less accurate)
      const camPos = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      handDir = tip.clone().sub(camPos).normalize();
    }
    
    // Create ray from index finger tip in pointing direction
    // Use a longer ray to ensure it reaches the panel
    const ray = new THREE.Ray(tip, handDir);
    
    // Debug raycast (throttled)
    if (Math.random() < 0.05) { // 5% of calls
      console.log(`[FeedControls] Raycast: origin=(${tip.x.toFixed(2)}, ${tip.y.toFixed(2)}, ${tip.z.toFixed(2)}), dir=(${handDir.x.toFixed(2)}, ${handDir.y.toFixed(2)}, ${handDir.z.toFixed(2)})`);
    }
    
    // Check tutorial panel first (if visible) - HAND GESTURE BASED
    if (this.onboardingTutorial && (this.onboardingTutorial as any).isVisible?.()) {
      const tutorialHit = (this.onboardingTutorial as any).raycast?.(ray);
      
      if (tutorialHit?.button) {
        // Use pinch gesture on the pointing hand to click
        const pointingHandPinch = pointingSide === 'right' 
          ? this.hands.state.right.pinch 
          : this.hands.state.left.pinch;
        
        if (pointingHandPinch) {
          // Update hover state for visual feedback
          (this.onboardingTutorial as any).setButtonHover?.(tutorialHit.button);
          
          // Click on pinch (hand gesture click)
          const handled = (this.onboardingTutorial as any).handleButtonClick?.(tutorialHit.button);
          if (handled) {
            return; // Button click handled, don't process other UI
          }
        } else {
          // Just hovering - show visual feedback
          (this.onboardingTutorial as any).setButtonHover?.(tutorialHit.button);
        }
      } else {
        // Not pointing at any button - clear hover
        (this.onboardingTutorial as any).setButtonHover?.(null);
      }
    }
    
    // For other UI panels (auth, music), use hand-based ray (hand gesture pointing)
    // Check XR panels (auth, music) with hand gesture ray
    const authPanel = (this as any).authPanel as XRAuthPanel | undefined;
    const musicPanel = (this as any).musicPanel as XRMusicPanel | undefined;
    
    if (authPanel?.isVisible()) {
      const authHit = authPanel.raycast(ray);
      // Use pinch gesture on pointing hand to click (hand gesture click)
      const pointingHandPinch = pointingSide === 'right' 
        ? this.hands.state.right.pinch 
        : this.hands.state.left.pinch;
      if (authHit?.button && pointingHandPinch) {
        authPanel.handleClick(authHit.button);
        return;
      }
    }
    
    if (musicPanel?.isVisible()) {
      const musicHit = musicPanel.raycast(ray);
      // Use pinch gesture on pointing hand to click (hand gesture click)
      const pointingHandPinch = pointingSide === 'right' 
        ? this.hands.state.right.pinch 
        : this.hands.state.left.pinch;
      if (musicHit?.button && pointingHandPinch) {
        musicPanel.handleClick(musicHit.button);
        return;
      }
    }

    const hit = this.hudMgr.raycastHit(ray);
    const hitKind = hit?.kind ?? null;

    // Comments section removed - no longer supported
    this.uiLastY = null;

    if (hitKind !== this.uiHoverKind) {
      this.uiHoverKind = hitKind;
      this.uiHoverBeganAt = now;
      return;
    }
    if (!hitKind) return;

    if (now - this.uiHoverBeganAt >= this.DWELL_MS) {
      this.uiHoverBeganAt = now + 10000;
      const key = this.currentModelKey();
      if (hitKind === 'like') {
        if (!this.acceptGesture('like')) return;
        this.store.likeCurrent();
        this.hudMgr.bump(key, 'like');
      } else if (hitKind === 'heart') {
        if (!this.acceptGesture('heart')) return;
        this.store.saveCurrent();
        this.hudMgr.bump(key, 'heart');
      } else if (hitKind === 'repost') {
        if (!this.acceptGesture('repost')) return;
        const n = performance.now();
        if (n - this.lastRepostAt >= this.REACT_COOLDOWN_MS) {
          this.lastRepostAt = n;
          this.store.repostCurrent();
          this.hudMgr.bump(key, 'repost');
        }
      }
    }
  }

  // ---------- rays (visual helpers only) ----------
  private initRay(side: 'left' | 'right') {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geom, this.rayMat);
    (line as any).computeLineDistances?.();
    if (side === 'left') {
      this.leftRay = line;
    } else {
      this.rightRay = line;
    }
    this.rayGroup.add(line);
  }
  private setRayVisible(side: 'left' | 'right', v: boolean) {
    const L = side === 'left' ? this.leftRay : this.rightRay;
    if (L) L.visible = v;
  }
  private initScrollRay() {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.scrollRay = new THREE.Line(geom, this.scrollRayMat);
    this.scrollRay.visible = false;
    (this.scrollRay as any).computeLineDistances?.(); // Required for dashed lines
    this.rayGroup.add(this.scrollRay);
  }
  
  private updateRays() {
    const objPos = this.store.getObjectWorldPos();
    const fallbackDir = new THREE.Vector3(0, 0, -1);
    const update = (side: 'left' | 'right', line?: THREE.Line) => {
      if (!line) return;
      const pinching = this.hands.state[side].pinch;
      const show =
        pinching && !this.scrollDisarmedThisPinch && !this.grabbing && !this.hudMgr.isComposing();
      if (!show) {
        line.visible = false;
        return;
      }

      const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      if (!from) {
        line.visible = false;
        return;
      }

      // Reuse fallbackDir vector for performance
      const to = objPos ? objPos.clone() : from.clone().add(fallbackDir.set(0, 0, -0.6));
      const pos = (line.geometry as THREE.BufferGeometry).getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      if (pos) {
        pos.setXYZ(0, from.x, from.y, from.z);
        pos.setXYZ(1, to.x, to.y, to.z);
        pos.needsUpdate = true;
        (line as any).computeLineDistances?.();
        line.visible = true;
      }
    };
    update('left', this.leftRay);
    update('right', this.rightRay);
    
    // Update rubber band scroll ray
    this.updateScrollRay(objPos);
  }
  
  private updateScrollRay(objPos: THREE.Vector3 | null) {
    if (!this.scrollRay || !objPos) {
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }
    
    // CRITICAL: Hide scroll ray during tutorial grab step
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      if (tutorial.isGrabStepActive && tutorial.isGrabStepActive()) {
        this.scrollRay.visible = false;
        return;
      }
    }
    
    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    const side: 'left' | 'right' = rp ? 'right' : (lp ? 'left' : null);
    
    if (!side || !this.scrollArmed || this.grabbing || this.grabPending) {
      this.scrollRay.visible = false;
      return;
    }
    
    const mid = this.hands.pinchMid(side);
    if (!mid) {
      this.scrollRay.visible = false;
      return;
    }
    
    // Show rubber band line from hand to object center
    const pos = (this.scrollRay.geometry as THREE.BufferGeometry).getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    if (pos) {
      // Elastic effect: line connects hand to object, with slight curve for rubber band feel
      const handPos = mid;
      const objCenter = objPos;
      
      // Calculate distance for elastic effect
      const dist = handPos.distanceTo(objCenter);
      const maxDist = 0.5; // Maximum distance before line becomes more visible
      const elasticFactor = Math.min(dist / maxDist, 1.0);
      
      // Update line color based on stretch (more stretched = more visible)
      (this.scrollRay.material as THREE.LineDashedMaterial).opacity = 0.3 + (elasticFactor * 0.4);
      (this.scrollRay.material as THREE.LineDashedMaterial).color.setHex(
        elasticFactor > 0.7 ? 0xffff88 : 0x88ff88 // Yellow when stretched, green when relaxed
      );
      
      pos.setXYZ(0, handPos.x, handPos.y, handPos.z);
      pos.setXYZ(1, objCenter.x, objCenter.y, objCenter.z);
      pos.needsUpdate = true;
      (this.scrollRay as any).computeLineDistances?.(); // Update dashes for new positions
      this.scrollRay.visible = true;
    }
  }

  // ---------- pinch lifecycle / feed scroll ----------
  private onPinchStart(side: 'left' | 'right') {
    // CRITICAL: After tutorial completion, FeedControls is the ONLY handler
    // Only block if tutorial is actively handling grab/scroll steps
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      // Tutorial is active - check if it's handling grab/scroll
      if (tutorial.isGrabStepActive && tutorial.isGrabStepActive()) {
        // Tutorial is handling grab - disable FeedControls grab
        console.log('[FeedControls] Tutorial grab active - blocking FeedControls');
        return;
      }
      if (tutorial.isScrollStepActive && tutorial.isScrollStepActive()) {
        // Tutorial is handling scroll - disable FeedControls scroll
        console.log('[FeedControls] Tutorial scroll active - blocking FeedControls');
        return;
      }
      // For other tutorial steps, allow FeedControls to work normally
    } else {
      // Tutorial is NOT active - ensure scroll is enabled
      console.log(`[FeedControls] Tutorial NOT active - enabling scroll for ${side} hand`);
    }
    
    // PRIORITY 1: Try clicking the MR HUD
    // But don't block grab - check if we're close to object first
    const pinch = this.hands.pinchMid(side);
    const d = pinch ? this.distanceToObjectSurface(pinch) : null;
    
    // Only try HUD click if we're far from object (to avoid blocking grab)
    if (d == null || d > 0.3) {
      if (this.tryClickHud(side)) return;
    }

    // PRIORITY 2: Normal interactions (scroll, grab, etc)
    this.setRayVisible(side, true);
    this.pinchStartAt = performance.now();
    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y != null) {
      this.lastPinchY = y;
      this.filtPinchY = y;
      this.scrollAccum = 0;
    }
    this.scrollDisarmedThisPinch = false;
    this.scrollArmed = false;

    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) {
      this.twoHandActive = false;
      return;
    }

    // Use pinch from above (already calculated)
    // const pinch = this.hands.pinchMid(side);
    // const d = pinch ? this.distanceToObjectSurface(pinch) : null;
    
    // CRITICAL: Scroll has priority - activate quickly for feed navigation
    // Only start grab if user is very close to object (clear intent to grab)
    const objPosNow = this.store.getObjectWorldPos();
    const objExists = !!this.store.getObject();
    
    if (objExists && objPosNow && pinch) {
      // Instant grab if VERY close to object (clear grab intent)
      if (d != null && d <= this.INSTANT_GRAB_DIST) {
        console.log(`[FeedControls] ✅ Instant grab activated! Distance: ${d.toFixed(3)}m`);
        this.grabbing = true;
        this.grabSide = side;
        this.grabOffset.copy(objPosNow).sub(pinch);
        this.store.notify('Grabbed');
        this.scrollDisarmedThisPinch = true;
        return;
      }
      
      // If moderately close, start grab pending but allow scroll to override
      // Scroll can still trigger if user moves hand vertically (feed navigation intent)
      if (d != null && d <= 0.15) { // Within 15cm - likely grab intent
        this.tryStartGrabPending(side);
        // Don't disarm scroll - let user's movement decide (scroll vs grab)
      } else {
        // Far from object - prioritize scroll (feed navigation)
        // Don't start grab pending - scroll is the primary action
        console.log(`[FeedControls] Far from object (${d.toFixed(3)}m) - scroll prioritized`);
      }
    } else if (d != null && d >= this.SCROLL_START_FAR) {
      // Very far from object - definitely scroll
      console.log(`[FeedControls] Very far from object (${d.toFixed(3)}m) - scroll prioritized`);
    }
  }

  private onPinchEnd(side: 'left' | 'right') {
    // Always hide ray
    this.setRayVisible(side, false);
    
    // Don't block grab/place - allow it to complete normally even during tutorial
    // Only block scroll during tutorial
    if (this.grabPending && this.grabPendingSide === side) this.cancelGrabPending();
    if (this.grabbing && this.grabSide === side) {
      this.grabbing = false;
      this.grabSide = null;
      this.store.notify('Placed');
    }
    const other = side === 'left' ? 'right' : 'left';
    if (!this.hands.state[other].pinch) {
      this.twoHandActive = false;
      this.rotVel = 0;
    }
    this.scrollArmed = false;
    this.scrollDisarmedThisPinch = false;
    this.lastPinchY = null;
    this.filtPinchY = null;
    this.scrollAccum = 0;
    this.pinchStartAt = null;

    // reset hysteresis when user leaves a gesture interaction
    this.lastStableKind = null;
  }

  private updateScroll(now: number) {
    if (now < this.scrollCooldownUntil) return;
    
    // CRITICAL: After tutorial completion, FeedControls handles ALL scroll
    // Only block if tutorial is actively handling scroll/grab
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      if (tutorial.isGrabStepActive && tutorial.isGrabStepActive()) {
        // Tutorial grab is active - disable scroll
        if (this.scrollRay) this.scrollRay.visible = false;
        return;
      }
      if (tutorial.isScrollStepActive && tutorial.isScrollStepActive()) {
        // Tutorial scroll is active - disable FeedControls scroll
        if (this.scrollRay) this.scrollRay.visible = false;
        return;
      }
    } else {
      // Tutorial is NOT active - scroll should work normally
      // Add debug logging to help diagnose issues
      if (Math.random() < 0.05) { // 5% of calls to avoid spam
        console.log(`[Scroll] Tutorial inactive - scroll enabled. Armed: ${this.scrollArmed}, Disarmed: ${this.scrollDisarmedThisPinch}, Grabbing: ${this.grabbing}`);
      }
    }
    
    // CRITICAL: Scroll has priority - only block if actively grabbing (not just pending)
    // This allows scroll to trigger even if grab is pending, giving scroll priority
    if (this.grabbing) {
      // Actively grabbing - block scroll
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }
    
    // If grab is pending but user is moving vertically, cancel grab and allow scroll
    // This gives scroll priority for feed navigation
    if (this.grabPending && this.lastPinchY != null) {
      const mid = this.hands.pinchMid(this.hands.state.left.pinch ? 'left' : 'right');
      if (mid) {
        const y = mid.y;
        const dy = Math.abs(y - this.lastPinchY);
        if (dy > 0.01) { // 1cm vertical movement = scroll intent
          console.log(`[Scroll] Vertical movement detected (${(dy * 100).toFixed(1)}cm) - canceling grab, prioritizing scroll`);
          this.cancelGrabPending();
        }
      }
    }

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    
    // Allow scrolling with either hand, prefer right hand
    if (!lp && !rp) {
      // Reset scroll state when no pinch
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollArmed = false;
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }
    
    // Prefer right hand, fallback to left
    const side: 'left' | 'right' = rp ? 'right' : 'left';

    // CRITICAL: Scroll has priority - only disarm if actively grabbing
    // Don't disarm for grab pending - scroll can override
    if (this.scrollDisarmedThisPinch && this.grabbing) {
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }
    
    const mid = this.hands.pinchMid(side);
    if (!mid) return;
    
    // CRITICAL: Scroll activates quickly (80ms) - faster than grab (150ms)
    // This gives scroll priority for feed navigation
    if (this.pinchStartAt && now - this.pinchStartAt < this.SCROLL_MIN_HOLD_MS) {
      // During the short hold period, initialize tracking but don't scroll yet
      const y = mid.y;
      if (this.lastPinchY == null && y != null) {
        this.lastPinchY = y;
        this.filtPinchY = y;
      }
      return;
    }
    
    // Check distance from object - more lenient for easier scrolling
    const distSurf = this.distanceToObjectSurface(mid);
    
    // CRITICAL: Scroll has priority - arm quickly for feed navigation
    if (!this.scrollArmed) {
      // Only block if actively grabbing (not just pending)
      if (this.grabbing) {
        if (this.scrollRay) this.scrollRay.visible = false;
        return;
      }
      
      // Method 1: Distance-based arming (if far from object) - immediate
      // More lenient: reduce threshold by 50% to make scrolling easier
      const scrollStartDistance = this.SCROLL_START_FAR * 0.5; // 50% of normal distance
      if (distSurf != null && distSurf >= scrollStartDistance) {
        this.scrollArmed = true;
        console.log(`[Scroll] ✅ Armed by distance: ${distSurf.toFixed(3)}m (threshold: ${scrollStartDistance.toFixed(3)}m)`);
      }
      // Method 2: Movement-based arming (if hand moves vertically) - after hold time
      // More sensitive: reduce movement threshold
      else if (this.lastPinchY != null && this.pinchStartAt && (now - this.pinchStartAt >= this.SCROLL_MIN_HOLD_MS)) {
        const y = mid.y;
        const dy = Math.abs(y - this.lastPinchY);
        if (dy > 0.003) { // 0.3cm movement = arm scroll (more sensitive than before)
          this.scrollArmed = true;
          console.log(`[Scroll] ✅ Armed by movement: ${(dy * 100).toFixed(1)}cm after ${(now - this.pinchStartAt).toFixed(0)}ms`);
        }
      }
      // Method 3: Auto-arm after hold time if no grab (fallback - ensures scroll always works)
      // Faster auto-arm: reduce from 2x to 1.5x hold time
      else if (this.pinchStartAt && (now - this.pinchStartAt >= this.SCROLL_MIN_HOLD_MS * 1.5) && !this.grabPending) {
        // After 120ms (1.5x hold time) with no grab, auto-arm scroll
        this.scrollArmed = true;
        console.log(`[Scroll] ✅ Auto-armed after ${(now - this.pinchStartAt).toFixed(0)}ms (no grab detected)`);
      }
      
      // If still not armed, initialize tracking but don't scroll yet
      if (!this.scrollArmed) {
        const y = mid.y;
        if (this.lastPinchY == null && y != null) {
          this.lastPinchY = y;
          this.filtPinchY = y;
        }
        if (this.scrollRay) this.scrollRay.visible = false;
        return;
      }
    }
    
    // Must be armed to scroll
    if (!this.scrollArmed) {
      // Initialize tracking even if not armed yet
      const y = mid.y;
      if (this.lastPinchY == null && y != null) {
        this.lastPinchY = y;
        this.filtPinchY = y;
      }
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }

    const y = mid.y;
    if (this.filtPinchY == null) {
      this.filtPinchY = y;
      this.lastPinchY = y;
      return;
    }
    
    // Smooth the Y position
    this.filtPinchY = this.filtPinchY + (y - this.filtPinchY) * this.LPF_SCROLL_ALPHA;
    
    if (this.lastPinchY == null) {
      this.lastPinchY = this.filtPinchY;
      return;
    }

    const dy = this.filtPinchY - this.lastPinchY;
    this.lastPinchY = this.filtPinchY;
    
    // Check minimum velocity to avoid jitter (but be more lenient)
    if (Math.abs(dy) < this.SCROLL_VEL_MIN) {
      // Still accumulate small movements to make scroll more responsive
      if (Math.abs(dy) > 0.001) { // 1mm minimum
        this.scrollAccum += dy * 0.5; // Partial accumulation for small movements
      }
      return;
    }

    // Accumulate scroll displacement
    this.scrollAccum += dy;
    
    // Debug: log accumulation progress
    if (Math.random() < 0.1) { // 10% of calls
      console.log(`[Scroll] Accumulating: dy=${dy.toFixed(4)}m, total=${this.scrollAccum.toFixed(4)}m, threshold=${this.SCROLL_DISP}m`);
    }
    
    // Trigger scroll when threshold reached
    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP) {
      const dir = this.scrollAccum < 0 ? +1 : -1;
      console.log(`[Scroll] ✅✅✅ TRIGGERING SCROLL! Direction: ${dir > 0 ? 'Next' : 'Previous'}, Accum: ${this.scrollAccum.toFixed(4)}m`);
      this.store.next(dir);
      this.hudMgr.showFor(this.currentModelKey());
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
      
      // Visual feedback
      this.store.notify(dir > 0 ? '⬇️ Next' : '⬆️ Previous');
    }
  }

  // ---------- two-hand transform ----------
  private updateTwoHandTransform(dt: number) {
    // CRITICAL: After tutorial completion, two-hand transform should work normally
    // Only block if tutorial is actively handling two-hand gestures
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      // Check if tutorial is on a two-hand step (rotate/scale)
      const currentGesture = tutorial.getCurrentGesture?.();
      if (currentGesture !== 'twohandrotate' && currentGesture !== 'twohandscale') {
        // Tutorial is active but not on two-hand step - allow FeedControls to handle it
        // Continue with normal two-hand transform
      } else {
        // Tutorial is handling two-hand gesture - let it handle it
        return;
      }
    }
    
    const lp = this.hands.state.left.pinch,
      rp = this.hands.state.right.pinch;
    if (this.grabPending || this.grabbing) return;
    if (!(lp && rp)) {
      if (this.twoHandActive) {
        this.twoHandActive = false;
        this.rotVel = 0;
      }
      return;
    }

    const Lp = this.hands.pinchMid('left') ?? this.hands.thumbTip('left');
    const Rp = this.hands.pinchMid('right') ?? this.hands.thumbTip('right');
    if (!(Lp && Rp)) {
      if (this.twoHandActive) {
        this.twoHandActive = false;
        this.rotVel = 0;
      }
      return;
    }

    this.lastL.copy(Lp);
    this.lastR.copy(Rp);

    const rawDist = Math.max(1e-6, Lp.distanceTo(Rp));
    if (!this.twoHandActive) {
      this.twoHandActive = true;
      this.baseDist = rawDist;
      this.baseScale = this.store.scale;
      this.filtDist = rawDist;
      this.rotTarget = this.store.rotationY;
      this.LStart.copy(Lp);
      this.RStart.copy(Rp);
      return;
    }

    this.filtDist = this.filtDist + (rawDist - this.filtDist) * this.LPF_ALPHA;
    const ratio = this.filtDist / this.baseDist;
    let scaleRaw = this.baseScale * Math.pow(ratio, this.SCALE_GAIN);
    // No scale limits - allow unlimited scaling
    scaleRaw = Math.max(0.001, scaleRaw); // Only prevent negative/zero scale

    let newScale = this.store.scale;
    if (Math.abs(scaleRaw - this.store.scale) > this.SCALE_DEADBAND) newScale = scaleRaw;

    const lMove = this.lastL.distanceTo(this.LStart);
    const rMove = this.lastR.distanceTo(this.RStart);
    const movedEnough = lMove + rMove >= this.MOVE_EPS * 2;

    const aNow = Math.atan2(this.lastR.z - this.lastL.z, this.lastR.x - this.lastL.x);
    const aBase = Math.atan2(this.RStart.z - this.LStart.z, this.RStart.x - this.LStart.x);
    let dA = aNow - aBase;
    while (dA > Math.PI) dA -= 2 * Math.PI;
    while (dA < -Math.PI) dA += 2 * Math.PI;

    if (movedEnough && Math.abs(dA) >= this.ROT_DEADZONE) {
      dA = THREE.MathUtils.clamp(dA, -this.ROT_MAX_DELTA, this.ROT_MAX_DELTA);
      const desired = this.store.rotationY - dA * this.ROT_GAIN;
      this.rotTarget = desired;
    }

    const smoothed = this.smoothDampAngle(
      this.store.rotationY,
      this.rotTarget,
      (v) => (this.rotVel = v),
      this.rotVel,
      this.ROT_SMOOTH_TIME,
      this.ROT_MAX_SPEED,
      dt
    );
    this.store.setTargetTransform(newScale, smoothed);
  }

  private smoothDampAngle(
    current: number,
    target: number,
    setVel: (v: number) => void,
    currentVel: number,
    smoothTime: number,
    maxSpeed: number,
    deltaTime: number
  ) {
    let delta = target - current;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    target = current + delta;
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const originalTo = target;
    const maxChange = maxSpeed * smoothTime;
    change = THREE.MathUtils.clamp(change, -maxChange, maxChange);
    target = current - change;
    const temp = (currentVel + omega * (target - current)) * deltaTime;
    const newVel = (currentVel - omega * temp) * exp;
    let output = target + (change + temp) * exp;
    const origDelta = originalTo - current,
      outDelta = output - originalTo;
    if (origDelta * outDelta > 0) {
      output = originalTo;
      setVel(0);
      return output;
    }
    setVel(newVel);
    return output;
  }

  // ---------- grab ----------
  private updateAutoAcquirePending() {
    if (this.grabPending || this.grabbing) return;
    
    // CRITICAL: After tutorial completion, FeedControls handles grab
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      if (tutorial.isGrabStepActive && tutorial.isGrabStepActive()) {
        return; // Tutorial is handling grab
      }
    }
    
    const lp = this.hands.state.left.pinch,
      rp = this.hands.state.right.pinch;
    if (lp === rp) return; // Need exactly one hand pinching
    const side: 'left' | 'right' = lp ? 'left' : 'right';
    const other = lp ? 'right' : 'left';
    if (this.hands.state[other].pinch) return; // Other hand must not be pinching
    
    const pinch = this.hands.pinchMid(side);
    if (!pinch) return;
    
    // CRITICAL: Make grab work from ANY distance - just check if object exists
    const objExists = !!this.store.getObject();
    const objPos = this.store.getObjectWorldPos();
    
    if (objExists && objPos) {
      // Object exists - can grab from any distance!
      this.tryStartGrabPending(side);
    }
  }
  private tryStartGrabPending(side: 'left' | 'right') {
    // CRITICAL: After tutorial completion, FeedControls handles grab
    // Only block if tutorial is actively handling grab
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      if (tutorial.isGrabStepActive && tutorial.isGrabStepActive()) {
        // Tutorial is handling grab - don't interfere
        return;
      }
    }
    
    if (this.grabbing || this.grabPending) {
      return; // Already grabbing
    }
    
    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) return; // Two-hand mode
    
    const pinch = this.hands.pinchMid(side);
    if (!pinch) return;
    
    // CRITICAL: Make grab work from ANY distance - remove distance restriction
    // This makes grab much more reliable and user-friendly
    const objPosNow = this.store.getObjectWorldPos();
    const objExists = !!this.store.getObject();
    
    if (!objExists || !objPosNow) {
      // No object - can't grab
      return;
    }
    
    // Start grab pending - works from any distance!
    console.log(`[Grab] Starting grab pending for ${side} hand (works from any distance)`);
    this.grabPending = true;
    this.grabPendingSide = side;
    this.grabPendingStartY = this.hands.pinchMid(side)?.y ?? null;
    
    if (this.grabTimer != null) clearTimeout(this.grabTimer);
    this.grabTimer = window.setTimeout(() => {
      if (!this.grabPending || this.grabPendingSide !== side) {
        return; // Already canceled
      }
      
      const other = side === 'left' ? 'right' : 'left';
      const stillPinching = this.hands.state[side].pinch && !this.hands.state[other].pinch;
      const mid = this.hands.pinchMid(side);
      const objPosNow = this.store.getObjectWorldPos();
      
      if (!stillPinching || !mid || !objPosNow) {
        this.cancelGrabPending();
        return;
      }
      
      // Activate grab!
      this.grabOffset.copy(objPosNow).sub(mid);
      this.grabPending = false;
      this.grabPendingSide = null;
      this.grabPendingStartY = null;
      this.grabbing = true;
      this.grabSide = side;
      console.log(`[Grab] ✅ Grab activated! User can now move object`);
      this.store.notify('Grabbed – move your hand to place');
    }, this.HOLD_MS);
  }
  private cancelGrabPending() {
    if (this.grabPending) {
      console.log(`[Grab] Grab pending canceled`);
    }
    this.grabPending = false;
    this.grabPendingSide = null;
    this.grabPendingStartY = null;
    if (this.grabTimer != null) {
      clearTimeout(this.grabTimer);
      this.grabTimer = null;
    }
  }
  private updateGrabPendingGuard() {
    if (!this.grabPending || !this.grabPendingSide) return;
    
    // Only cancel if other hand starts pinching (two-hand mode)
    const other = this.grabPendingSide === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) {
      this.cancelGrabPending();
      return;
    }
    
    // Don't cancel based on Y movement - allow user to move hand while holding
    // The original logic was too strict and prevented natural grab movements
    // We only cancel if user releases pinch or other hand pinches
  }
  private updateGrabDrag() {
    // CRITICAL: After tutorial completion, FeedControls handles grab
    // Only block if tutorial is actively handling grab
    if (this.isTutorialActive()) {
      const tutorial = this.onboardingTutorial as any;
      if (tutorial.isGrabStepActive && tutorial.isGrabStepActive()) {
        // Tutorial is handling grab - disable FeedControls grab
        if (this.grabbing) {
          this.grabbing = false;
          this.grabSide = null;
        }
        return;
      }
    }
    
    if (!this.grabbing || !this.grabSide) {
      // Debug: log why grab drag isn't running
      if (Math.random() < 0.01) { // 1% of calls
        console.log(`[Grab] updateGrabDrag skipped: grabbing=${this.grabbing}, grabSide=${this.grabSide}`);
      }
      return;
    }
    
    try {
      const other = this.grabSide === 'left' ? 'right' : 'left';
      if (this.hands.state[this.grabSide].pinch && this.hands.state[other].pinch) {
        this.grabbing = false;
        this.grabSide = null;
        this.store.notify('Grab canceled (two-hand mode)');
        return;
      }
      if (!this.hands.state[this.grabSide].pinch) {
        this.grabbing = false;
        this.grabSide = null;
        console.log(`[Grab] Object placed`);
        this.store.notify('Placed');
        return;
      }
      const mid = this.hands.pinchMid(this.grabSide);
      if (!mid) {
        // If we lose hand tracking, cancel grab to prevent freeze
        console.log(`[Grab] Lost hand tracking, canceling grab`);
        this.grabbing = false;
        this.grabSide = null;
        return;
      }
      
      // Only update position if object exists
      const objPos = this.store.getObjectWorldPos();
      if (!objPos) {
        // Object doesn't exist, cancel grab
        console.log(`[Grab] Object doesn't exist, canceling grab`);
        this.grabbing = false;
        this.grabSide = null;
        return;
      }
      
      // Update position safely
      const newPos = mid.clone().add(this.grabOffset);
      
      // Always update position during grab - don't skip based on distance
      // This ensures smooth movement even for small hand movements
      this.store.setPosition(newPos);
      
      // Debug: log position updates (throttled for performance)
      if (Math.random() < 0.1) { // 10% of calls
        console.log(`[Grab] Moving object: hand=${mid.toArray().map(v => v.toFixed(3)).join(',')}, offset=${this.grabOffset.toArray().map(v => v.toFixed(3)).join(',')}, newPos=${newPos.toArray().map(v => v.toFixed(3)).join(',')}, currentObjPos=${objPos.toArray().map(v => v.toFixed(3)).join(',')}`);
      }
    } catch (error) {
      // If any error occurs, cancel grab to prevent freeze
      logError(error, 'FeedControls.updateGrabDrag');
      this.grabbing = false;
      this.grabSide = null;
    }
  }

  // helpers
  private distanceToObjectSurface(worldPoint: THREE.Vector3): number | null {
    const info = this.store.getObjectBounds();
    if (!info) return null;
    const { center, radius } = info;
    const distCenter = worldPoint.distanceTo(center);
    return Math.max(0, distCenter - (radius + 0.04));
  }
  private currentModelKey(): string {
    const anyStore = this.store as any;
    if (typeof anyStore.getCurrentKey === 'function') return String(anyStore.getCurrentKey());
    return 'default';
  }
}

export default FeedControls;
