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
import { CONTROLS, TRANSFORM, REACTIONS, HUD, MULTIPLAYER } from '../config/constants';
import { logError } from '../utils/errors';
import { UIRaycastVisualizer } from '../interaction/UIRaycastVisualizer';

export class FeedControls {
  // ----- feed scroll -----
  private lastPinchY: number | null = null;
  private filtPinchY: number | null = null;
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private pinchStartAt: number | null = null;
  private scrollArmed = false;
  private scrollDisarmedThisPinch = false;
  private scrollSide: 'left' | 'right' | undefined = undefined; // Track which hand is scrolling
  private transformEndCooldownUntil = 0; // Cooldown after transform ends to prevent accidental scroll

  // Scroll control constants
  private readonly SCROLL_MIN_HOLD_MS = CONTROLS.SCROLL_MIN_HOLD_MS;
  private readonly SCROLL_DISP = CONTROLS.SCROLL_DISPLACEMENT;
  private readonly SCROLL_COOLDOWN_MS = CONTROLS.SCROLL_COOLDOWN_MS;
  private readonly SCROLL_VEL_MIN = CONTROLS.SCROLL_MIN_VELOCITY;
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
  private readonly GRAB_MAX_DIST = TRANSFORM.GRAB_MAX_DISTANCE;
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
  // Color changes based on state: gray (ready) → green (armed) → yellow (scrolling)
  private scrollRay?: THREE.Line;
  private scrollRayMat = new THREE.LineDashedMaterial({
    color: 0x888888, // Gray when not armed
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
  
  // Multiplayer panel interaction state
  private mpHoverButton: 'host' | 'join' | 'close' | null = null;
  private mpLastClickTime = 0; // Debounce rapid clicks
  private readonly MP_CLICK_DEBOUNCE_MS = MULTIPLAYER.CLICK_DEBOUNCE_MS;
  
  // Context-aware raycasting priority system
  private uiActive = false; // Track if any UI is currently active/interacting
  private uiActiveUntil = 0; // Timestamp until which UI remains prioritized
  private readonly UI_PRIORITY_DURATION_MS = MULTIPLAYER.UI_PRIORITY_DURATION_MS;
  
  // UI raycast visualizer (shows ray line when pointing at UI)
  private uiRaycastVisualizer: UIRaycastVisualizer;

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

  private onboardingTutorial: import('../types/tutorial').OnboardingTutorial | null = null;

  constructor(private app: ThreeXRApp, private hands: HandEngine, private store: FeedStore) {
    this.app.scene.add(this.rayGroup);
    this.initRay('left');
    this.initRay('right');
    this.setRayVisible('left', false);
    this.setRayVisible('right', false);
    
    // Initialize UI raycast visualizer
    this.uiRaycastVisualizer = new UIRaycastVisualizer(this.app.scene);
    
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
        if (this.isTutorialActive() && this.onboardingTutorial) {
          const currentGesture = this.onboardingTutorial.getCurrentGesture();
          if (currentGesture !== 'thumbsup') {
            // Tutorial is active but not on like step - disable gesture
            return;
          }
        }
        
        if (!this.canTriggerGesture('thumbsup')) return;
        if (!this.acceptGesture('like')) return;
        const now = performance.now();
        
        // ENHANCED: More aggressive cooldown to prevent emoji spam
        if (now - this.lastLikeAt < this.REACT_COOLDOWN_MS) {
          console.log('[Like] Cooldown active - ignoring rapid gesture');
          return;
        }
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
        if (this.isTutorialActive() && this.onboardingTutorial) {
          const currentGesture = this.onboardingTutorial.getCurrentGesture();
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
        
        // CRITICAL FIX: Broadcast heart gesture to multiplayer partner
        const mp = (this as any).multiplayer as any | undefined;
        if (mp?.isConnected && mp.broadcastGesture) {
          mp.broadcastGesture({
            type: 'heart',
            timestamp: now,
            position: heartPos ? { x: heartPos.x, y: heartPos.y, z: heartPos.z } : { x: 0, y: 0, z: 0 },
          });
        }
        
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
        
        // CRITICAL FIX: Broadcast repost gesture to multiplayer partner
        const mp = (this as any).multiplayer as any | undefined;
        if (mp?.isConnected && mp.broadcastGesture) {
          mp.broadcastGesture({
            type: 'repost',
            timestamp: now,
            position: peaceHand ? { x: peaceHand.x, y: peaceHand.y, z: peaceHand.z } : { x: 0, y: 0, z: 0 },
          });
        }
        
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

      // dwell ray (extra help on runtimes that don't send select)
      this.updateUiRayAndDwell(now);

      // Continuous UI raycast check (for visual feedback even when not pinching)
      this.updateUIRaycastVisualization();

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
        const shouldShow = this.onboardingTutorial?.shouldShowReactionHud() ?? true;
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
      
      // ENHANCED: Continuous hover tracking for multiplayer panel buttons
      this.updateMultiplayerPanelHover(dt);

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
        // CRITICAL FIX: World-locked tutorial panel (no billboarding)
        // Tutorial panel should stay fixed in world space, not follow camera
        // The tutorial panel's updatePosition method handles its own orientation
      }
    });
  }

  // Set onboarding tutorial reference to disable controls during tutorial
  setOnboardingTutorial(tutorial: any) {
    this.onboardingTutorial = tutorial;
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
    return this.onboardingTutorial?.isTutorialActive() ?? false;
  }

  /**
   * Comprehensive reset after tutorial completion.
   * Ensures scroll / grab / scale / rotate / emoji gestures all work again.
   */
  resetScrollState(): void {
    console.log('[FeedControls] 🔄 Comprehensive reset after tutorial completion');

    // Scroll state
    this.lastPinchY = null;
    this.filtPinchY = null;
    this.scrollAccum = 0;
    this.scrollArmed = false;
    this.scrollDisarmedThisPinch = false;
    this.scrollSide = undefined;
    this.pinchStartAt = null;
    this.scrollCooldownUntil = 0;
    this.transformEndCooldownUntil = 0; // Reset transform cooldown
    if (this.scrollRay) this.scrollRay.visible = false;

    // Grab state
    this.grabPending = false;
    this.grabPendingSide = null;
    this.grabPendingStartY = null;
    if (this.grabTimer != null) {
      clearTimeout(this.grabTimer);
      this.grabTimer = null;
    }
    this.grabbing = false;
    this.grabSide = null;
    this.grabOffset.set(0, 0, 0);

    // Two-hand transform state
    this.twoHandActive = false;
    this.baseDist = 0;
    this.baseScale = this.store.scale;
    this.filtDist = 0;
    this.rotTarget = this.store.rotationY;
    this.rotVel = 0;
    this.LStart.set(0, 0, 0);
    this.RStart.set(0, 0, 0);
    this.lastL.set(0, 0, 0);
    this.lastR.set(0, 0, 0);

    // Gesture maps / cooldowns
    this.gestureTriggered.clear();
    this.gestureCooldown.clear();
    this.clusterCooldownUntil = 0;
    this.lastStableCheckAt = 0;
    this.lastStableKind = null;

    // UI state
    this.uiHoverKind = null;
    this.uiHoverBeganAt = 0;
    this.uiLastY = null;
    this.setRayVisible('left', false);
    this.setRayVisible('right', false);

    console.log('[FeedControls] ✅ Reset complete: scroll, grab, scale, rotate, emoji gestures enabled');
  }

  /**
   * Quick verification helper – useful for debugging production issues.
   */
  verifyFeaturesEnabled(): boolean {
    const tutorialDone = this.isTutorialCompleted();
    const tutorialActive = this.isTutorialActive();
    const ok = tutorialDone && !tutorialActive;
    console.log('[FeedControls] 🔍 Feature verification', {
      tutorialDone,
      tutorialActive,
      scrollArmed: this.scrollArmed,
      grabbing: this.grabbing,
      twoHandActive: this.twoHandActive,
    });
    if (!ok) {
      console.warn('[FeedControls] ⚠️ Tutorial state invalid - features may still be blocked');
    }
    return ok;
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
  /** ENHANCED: More lenient thresholds for easier intentional triggering, harder accidental */
  private acceptGesture(kind: 'like' | 'heart' | 'repost'): boolean {
    const now = performance.now();

    // collapse bursts that happen while hands are together & low
    if (this.handsCloseAndLow()) {
      if (now < this.clusterCooldownUntil) return false;
      this.clusterCooldownUntil = now + this.CLUSTER_COOLDOWN_MS;
    }

    // ENHANCED: Reduced hold time for heart gesture (more responsive)
    // Other gestures keep standard hold time to prevent false positives
    const holdTime = kind === 'heart' ? this.GESTURE_HOLD_MS * 0.6 : this.GESTURE_HOLD_MS;
    
    // simple hold hysteresis: same kind must be "stable" for holdTime
    if (this.lastStableKind !== kind) {
      this.lastStableKind = kind;
      this.lastStableCheckAt = now;
      return false; // first frame we see this kind -> start timing
    }
    if (now - this.lastStableCheckAt < holdTime) return false;

    // passed gates
    this.lastStableCheckAt = now; // keep ticking while continuing
    return true;
  }

  // NOTE: External composer removed - was freezing XR session
  // Now using built-in ReactionHud compose mode (stays in VR)

  // ========== UNIFIED INTERACTION SYSTEM ==========
  /**
   * Unified pinch+raycast interaction pipeline
   * Content-agnostic: works for both UI panels and 3D objects
   * Priority: UI panels always win when active/visible
   * 
   * Design principles:
   * 1. UI elements checked first (tutorial, multiplayer, keypad, HUD)
   * 2. Within UI, closer hits win (distance-based tie-breaking)
   * 3. Ray direction always normalized for consistent results
   * 4. Deterministic: same ray always produces same result
   * 5. Works for both visualization (no pinch required) and interaction (pinch required)
   * 
   * @param side - Which hand to check
   * @param requirePinch - If true, only handle interactions when pinching. If false, check for hits for visualization.
   * @returns true if interaction was handled (UI or 3D), false if nothing hit
   */
  private performUnifiedInteraction(side: 'left' | 'right', requirePinch: boolean = true): { handled: boolean; target: 'ui' | '3d' | null } {
    const pinch = this.hands.pinchMid(side);
    const tip = this.hands.indexTip(side);
    if (!pinch || !tip) {
      return { handled: false, target: null };
    }

    // Create ray from index tip (consistent for all interactions)
    // CRITICAL: Always normalize ray direction for reliable raycasting
    const wrist = this.hands.wrist?.(side);
    let handDir: THREE.Vector3;
    if (wrist) {
      handDir = tip.clone().sub(wrist).normalize();
    } else {
      const camPos = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      handDir = tip.clone().sub(camPos).normalize();
    }
    
    // Ensure direction is normalized (safety check)
    if (handDir.lengthSq() < 0.001) {
      // Fallback: use camera forward direction
      this.app.camera.getWorldDirection(handDir);
    } else {
      handDir.normalize();
    }
    
    const ray = new THREE.Ray(tip, handDir);
    const isPinching = requirePinch ? this.hands.state[side].pinch : false;
    const now = performance.now();
    
    // Track UI hits with distance for priority sorting
    const uiHits: Array<{ hit: any; distance: number; handler: () => boolean }> = [];

    // PRIORITY 1: Check all UI panels first (tutorial, multiplayer, keyboard, HUD)
    // UI always takes precedence when visible/active
    // Within UI, closer hits win (distance-based priority)
    
    // 1. Tutorial panel (priority: 100)
    if (this.onboardingTutorial && (this.onboardingTutorial as any).isVisible?.()) {
      try {
        const tutorialHit = (this.onboardingTutorial as any).raycast?.(ray);
        if (tutorialHit?.button && isPinching) {
          const panelCenter = this.onboardingTutorial.group?.position;
          const distance = panelCenter ? tip.distanceTo(panelCenter) : Infinity;
          uiHits.push({
            hit: tutorialHit,
            distance,
            handler: () => {
              const handled = (this.onboardingTutorial as any).handleButtonClick?.(tutorialHit.button);
              if (handled) {
                this.uiActive = true;
                this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
              }
              return !!handled;
            }
          });
        }
      } catch (error) {
        logError(error, 'FeedControls.tutorialRaycast');
      }
    }

    // 2. Multiplayer panel & keyboard (priority: 90)
    const multiplayerPanel = (this as any).multiplayerPanel as any | undefined;
    if (multiplayerPanel) {
      try {
        const keypad = multiplayerPanel.getKeypad?.();
        const keyboardActive = keypad?.isVisible() || keypad?.isActive() || false;
        const panelActive = multiplayerPanel.isVisible?.() || false;
        
        if (keyboardActive || panelActive) {
          // Check keypad first (highest priority within multiplayer)
          if (keyboardActive && keypad?.raycastHit) {
            const keypadHit = keypad.raycastHit(ray);
            if (keypadHit && isPinching) {
              const keypadPos = keypad.group?.position;
              const distance = keypadPos ? tip.distanceTo(keypadPos) : Infinity;
              uiHits.push({
                hit: keypadHit,
                distance,
                handler: () => {
                  const handled = keypad.handleKeyPress?.(keypadHit);
                  if (handled) {
                    this.uiActive = true;
                    this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
                  }
                  return !!handled;
                }
              });
            }
          }
          
          // Check multiplayer panel buttons
          const mpHit = multiplayerPanel.raycastHit?.(ray);
          if (mpHit?.button && isPinching && multiplayerPanel.canClickButton?.(mpHit.button)) {
            const panelPos = multiplayerPanel.group?.position || multiplayerPanel.panel?.position;
            const distance = panelPos ? tip.distanceTo(panelPos) : Infinity;
            uiHits.push({
              hit: mpHit,
              distance,
              handler: () => {
                multiplayerPanel.handleClick(mpHit.button).catch(() => {});
                this.uiActive = true;
                this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
                return true;
              }
            });
          }
        }
      } catch (error) {
        logError(error, 'FeedControls.multiplayerRaycast');
      }
    }

    // 3. HUD (reaction buttons) (priority: 80)
    try {
      const hudHit = this.hudMgr.raycastHit(ray);
      if (hudHit && isPinching) {
        const hudPos = this.hudMgr.getPanelCenterWorld();
        const distance = tip.distanceTo(hudPos);
        const key = this.currentModelKey();
        
        uiHits.push({
          hit: hudHit,
          distance,
          handler: () => {
            if (hudHit.kind === 'like' && this.acceptGesture('like')) {
              this.store.likeCurrent(pinch.clone(), side);
              this.hudMgr.bump(key, 'like');
              this.uiActive = true;
              this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
              return true;
            } else if (hudHit.kind === 'heart' && this.acceptGesture('heart')) {
              this.store.saveCurrent(pinch.clone());
              this.hudMgr.bump(key, 'heart');
              this.uiActive = true;
              this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
              return true;
            } else if (hudHit.kind === 'repost' && this.acceptGesture('repost')) {
              const now = performance.now();
              if (now - this.lastRepostAt >= this.REACT_COOLDOWN_MS) {
                this.lastRepostAt = now;
                this.store.repostCurrent(pinch.clone(), side);
                this.hudMgr.bump(key, 'repost');
                this.uiActive = true;
                this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
                return true;
              }
            }
            return false;
          }
        });
      }
    } catch (error) {
      logError(error, 'FeedControls.hudRaycast');
    }
    
    // Process UI hits: closest hit wins (deterministic priority)
    if (uiHits.length > 0) {
      // Sort by distance (closest first)
      uiHits.sort((a, b) => a.distance - b.distance);
      const closestHit = uiHits[0];
      
      // Calculate hit point for visualization
      // Extend ray to hit distance
      const hitPoint = tip.clone().add(handDir.clone().multiplyScalar(closestHit.distance));
      
      // Try to get actual hit point from hit data if available
      let actualHitPoint = hitPoint;
      if (closestHit.hit && typeof closestHit.hit === 'object') {
        // Check if hit has point property (HudHit, MultiplayerHit may have it)
        if ('point' in closestHit.hit && closestHit.hit.point instanceof THREE.Vector3) {
          actualHitPoint = closestHit.hit.point;
        }
      }
      
      // Show UI raycast line (even when not pinching, for visual feedback)
      this.uiRaycastVisualizer.update(tip, {
        point: actualHitPoint,
        distance: closestHit.distance,
        panelId: 'ui-panel' // Generic identifier
      });
      
      // If pinching, handle the interaction
      if (isPinching) {
        // Try handlers in order until one succeeds
        for (const { handler } of uiHits) {
          if (handler()) {
            return { handled: true, target: 'ui' };
          }
        }
      }
      
      // UI hit but not pinching - still return handled to block 3D
      return { handled: true, target: 'ui' };
    } else {
      // No UI hit - hide UI raycast line
      this.uiRaycastVisualizer.update(tip, null);
    }

    // PRIORITY 2: No UI hit - allow 3D interactions (grab, scroll, etc.)
    // This is handled by the existing 3D interaction logic
    return { handled: false, target: '3d' };
  }
  
  /**
   * Continuous UI raycast visualization (called every frame)
   * Updates visual ray line when pointing at UI panels
   */
  private updateUIRaycastVisualization(): void {
    // Check both hands for UI hits (for visual feedback)
    for (const side of ['left', 'right'] as const) {
      const tip = this.hands.indexTip(side);
      if (!tip) continue;
      
      // Create ray from index tip
      const wrist = this.hands.wrist?.(side);
      let handDir: THREE.Vector3;
      if (wrist) {
        handDir = tip.clone().sub(wrist).normalize();
      } else {
        const camPos = new THREE.Vector3();
        this.app.camera.getWorldPosition(camPos);
        handDir = tip.clone().sub(camPos).normalize();
      }
      
      // Ensure direction is normalized
      if (handDir.lengthSq() < 0.001) {
        this.app.camera.getWorldDirection(handDir);
      } else {
        handDir.normalize();
      }
      
      const ray = new THREE.Ray(tip, handDir);
      
      // Check for UI hits (don't require pinching for visual feedback)
      const interaction = this.performUnifiedInteraction(side);
      
      // If UI was hit, visualizer is already updated in performUnifiedInteraction
      // If no UI hit, visualizer is cleared there too
      // Only need to check one hand (prefer right hand)
      if (side === 'right') {
        break; // Use right hand for visualization
      }
    }
  }
  
  /**
   * Check if UI is currently active (blocks 3D interactions)
   * This ensures UI always has priority over 3D
   */
  private isUIActive(): boolean {
    const now = performance.now();
    return this.uiActive && now < this.uiActiveUntil;
  }

  // ---------- Try to click multiplayer panel directly from pinch start ----------
  // CRITICAL FIX: Immediate pinch-to-click for multiplayer panel (dual-path: event + frame loop)
  /**
   * Continuous hover tracking for multiplayer panel buttons (called every frame)
   * Updates hover state based on finger proximity even when not pinching
   */
  private updateMultiplayerPanelHover(dt: number): void {
    const multiplayerPanel = (this as any).multiplayerPanel as any | undefined;
    if (!multiplayerPanel?.isVisible()) return;
    
    try {
      // Check both hands for hover
      for (const side of ['left', 'right'] as const) {
        const indexTip = this.hands.indexTip(side);
        if (indexTip && multiplayerPanel.checkTouchInteraction) {
          const touchedButton = multiplayerPanel.checkTouchInteraction(indexTip);
          if (touchedButton) {
            // Update hover state with actual delta time
            multiplayerPanel.setButtonHover(touchedButton, dt);
            return; // Only track one button at a time
          }
        }
      }
      
      // No button being touched - clear hover
      if (multiplayerPanel.setButtonHover) {
        multiplayerPanel.setButtonHover(null, dt);
      }
    } catch (error) {
      // Don't crash on hover tracking errors
      if (typeof window !== 'undefined' && (window as any).__DEBUG_UI) {
        console.error('[FeedControls] Error in updateMultiplayerPanelHover:', error);
      }
    }
  }

  private tryClickMultiplayerPanel(side: 'left' | 'right'): boolean {
    const multiplayerPanel = (this as any).multiplayerPanel as any | undefined;
    
    // Check keypad first (highest priority when visible)
    const keypad = multiplayerPanel?.getKeypad?.();
    if (keypad?.isVisible()) {
      const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      if (!from) return false;
      
      const tip = this.hands.indexTip(side);
      const wrist = this.hands.wrist?.(side);
      
      let handDir: THREE.Vector3;
      if (tip && wrist) {
        handDir = tip.clone().sub(wrist).normalize();
      } else if (tip) {
        const camPos = new THREE.Vector3();
        this.app.camera.getWorldPosition(camPos);
        handDir = tip.clone().sub(camPos).normalize();
      } else {
        const camPos = new THREE.Vector3();
        this.app.camera.getWorldPosition(camPos);
        handDir = from.clone().sub(camPos).normalize();
      }
      
      // CRITICAL FIX: Touch-based interaction (check finger proximity)
      const indexTip = this.hands.indexTip(side);
      if (indexTip) {
        const touchedKey = keypad.checkTouchInteraction(indexTip);
        if (touchedKey) {
          // Finger is touching a key - mark UI as active
          const now = performance.now();
          this.uiActive = true;
          this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
          
          // Check if touch has been held long enough
          const pressedKey = keypad.checkTouchPress();
          if (pressedKey) {
            keypad.handleKeyPress(pressedKey);
          }
          
          this.setRayVisible(side, false);
          this.scrollDisarmedThisPinch = true;
          return true; // Handled - block 3D interaction
        }
      }
    }
    
    if (!multiplayerPanel?.isVisible()) return false;
    
    const now = performance.now();
    // Debounce rapid clicks
    if (now - this.mpLastClickTime < this.MP_CLICK_DEBOUNCE_MS) {
      return false;
    }
    
    // ENHANCED: Try touch-based interaction first (more reliable for hand tracking)
    const indexTip = this.hands.indexTip(side);
    const isPinching = this.hands.state[side].pinch;
    
    if (indexTip && multiplayerPanel.checkTouchInteraction) {
      const touchedButton = multiplayerPanel.checkTouchInteraction(indexTip);
      if (touchedButton) {
        // Finger is touching a button - update hover state
        const dt = 1.0 / 60.0; // Approximate delta time
        multiplayerPanel.setButtonHover(touchedButton, dt);
        
        // SIMPLIFIED: Immediate click on pinch (no waiting for glow)
        if (isPinching && multiplayerPanel.canClickButton && multiplayerPanel.canClickButton(touchedButton)) {
          // Pinch detected while touching button - immediate click
          this.mpLastClickTime = now;
          multiplayerPanel.hideRayLine(this.app.scene);
          multiplayerPanel.handleClick(touchedButton).catch((error) => {
            console.error('[FeedControls] Multiplayer panel click error:', error);
          });
          this.setRayVisible(side, false);
          this.scrollDisarmedThisPinch = true;
          return true; // Handled
        }
        
        // Touch detected but not pinching - mark UI as active
        this.uiActive = true;
        this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
        this.setRayVisible(side, false);
        this.scrollDisarmedThisPinch = true;
        return true; // Handled - block 3D interaction while hovering
      }
    }
    
    // Fallback to raycast-based interaction (for pointing gestures)
    const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
    if (!from) {
      // No touch and no pinch position - clear hover
      if (multiplayerPanel.setButtonHover) {
        multiplayerPanel.setButtonHover(null, 0);
      }
      return false;
    }
    
    // Get pointing direction (index finger direction)
    const tip = this.hands.indexTip(side);
    const wrist = this.hands.wrist?.(side);
    
    let handDir: THREE.Vector3;
    if (tip && wrist) {
      handDir = tip.clone().sub(wrist).normalize();
    } else if (tip) {
      const camPos = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      handDir = tip.clone().sub(camPos).normalize();
    } else {
      // Fallback: use pinch position to camera
      const camPos = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      handDir = from.clone().sub(camPos).normalize();
    }
    
    const ray = new THREE.Ray(from, handDir);
    const mpHit = multiplayerPanel.raycastHit(ray);
    
    if (mpHit?.button) {
      // Hit detected via raycast - update hover state
      const dt = 1.0 / 60.0; // Approximate delta time
      const isPinching = this.hands.state[side].pinch;
      
      if (multiplayerPanel.setButtonHover) {
        multiplayerPanel.setButtonHover(mpHit.button, dt);
      }
      
      // SIMPLIFIED: Immediate click on pinch (no waiting for glow)
      if (isPinching && multiplayerPanel.canClickButton && multiplayerPanel.canClickButton(mpHit.button)) {
        // Pinch detected while pointing at button - immediate click
        this.mpLastClickTime = now;
        multiplayerPanel.hideRayLine(this.app.scene);
        multiplayerPanel.handleClick(mpHit.button).catch((error) => {
          console.error('[FeedControls] Multiplayer panel click error:', error);
        });
        this.setRayVisible(side, false);
        this.scrollDisarmedThisPinch = true;
        return true; // Handled
      }
      
      // Raycast hit but not pinching - mark UI as active
      this.uiActive = true;
      this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
      this.setRayVisible(side, false);
      this.scrollDisarmedThisPinch = true;
      return true; // Handled - block 3D interaction while hovering
    } else {
      // No hit - clear hover
      if (multiplayerPanel.setButtonHover) {
        multiplayerPanel.setButtonHover(null, 0);
      }
    }
    
    return false; // Not handled
  }

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

  // ---------- hand gesture-based UI interaction (pointing + dwell) ----------
  private updateUiRayAndDwell(now: number) {
    // Use hand gestures: point with index finger, dwell to click (like ReactionHud)
    // Try right hand first, then left hand
    const rightTip = this.hands.indexTip('right');
    const leftTip = this.hands.indexTip('left');
    const tip = rightTip ?? leftTip;
    const pointingSide = rightTip ? 'right' : 'left';
    
    if (!tip) {
      this.uiHoverKind = null;
      this.uiLastY = null;
      this.mpHoverButton = null;
      return;
    }
    
    // Get hand direction from index finger pointing direction
    const wrist = this.hands.wrist?.(pointingSide);
    
    let handDir: THREE.Vector3;
    if (wrist) {
      handDir = tip.clone().sub(wrist).normalize();
    } else {
      const camPos = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      handDir = tip.clone().sub(camPos).normalize();
    }
    
    const ray = new THREE.Ray(tip, handDir);
    
    // CRITICAL FIX: Context-aware priority system
    // Check if UI is active (keypad, panels) - if so, prioritize UI over 3D objects
    const uiIsActive = this.uiActive || now < this.uiActiveUntil;
    
    // Check distance to object to determine if we should prioritize UI
    const pinch = this.hands.pinchMid(pointingSide);
    const d = pinch ? this.distanceToObjectSurface(pinch) : null;
    const farFromObject = d == null || d > 0.3;
    
    // Debug raycast (throttled)
    if (Math.random() < 0.05) { // 5% of calls
      console.log(`[FeedControls] Raycast: origin=(${tip.x.toFixed(2)}, ${tip.y.toFixed(2)}, ${tip.z.toFixed(2)}), dir=(${handDir.x.toFixed(2)}, ${handDir.y.toFixed(2)}, ${handDir.z.toFixed(2)})`);
    }
    
    // Check tutorial panel first (if visible) - HAND GESTURE BASED
    if (this.onboardingTutorial && (this.onboardingTutorial as any).isVisible?.()) {
      // ENHANCED: Try touch-based interaction first (more reliable)
      const indexTip = this.hands.indexTip(pointingSide);
      const isPinching = pointingSide === 'right' 
        ? this.hands.state.right.pinch 
        : this.hands.state.left.pinch;
      let tutorialButton: 'prev' | 'next' | 'skip' | null = null;
      
      if (indexTip && (this.onboardingTutorial as any).checkTouchInteraction) {
        tutorialButton = (this.onboardingTutorial as any).checkTouchInteraction(indexTip);
      }
      
      // Fallback to raycast if no touch detected
      if (!tutorialButton) {
        const tutorialHit = (this.onboardingTutorial as any).raycast?.(ray);
        tutorialButton = tutorialHit?.button || null;
      }
      
      if (tutorialButton) {
        // Update hover state
        (this.onboardingTutorial as any).setButtonHover?.(tutorialButton);
        
        // ENHANCED: Immediate click on pinch (no waiting for glow)
        if (isPinching && (this.onboardingTutorial as any).canClickButton && 
            (this.onboardingTutorial as any).canClickButton(tutorialButton)) {
          // Pinch detected while pointing at button - immediate click
          const handled = (this.onboardingTutorial as any).handleButtonClick?.(tutorialButton);
          if (handled) {
            return; // Button click handled, don't process other UI
          }
        } else {
          // Not pinching - mark UI as active for visual feedback
          this.uiActive = true;
          this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
        }
      } else {
        // Not pointing at any button - clear hover
        (this.onboardingTutorial as any).setButtonHover?.(null);
      }
    }
    
    // For other UI panels (auth, music, multiplayer), use hand-based ray (hand gesture pointing)
    // Check XR panels with hand gesture ray
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
    
    // CRITICAL FIX: Touch-based keyboard interaction (proximity/collider detection)
    // Enhanced with error handling and null safety
    try {
      const multiplayerPanel = (this as any).multiplayerPanel as any | undefined;
      if (!multiplayerPanel) return; // Early return if panel doesn't exist
      
      const keypad = multiplayerPanel.getKeypad?.();
      if (!keypad || !keypad.isVisible()) return; // Early return if keypad not visible
      
      // CRITICAL FIX: Use touch-based interaction instead of raycast
      // Check both hands for finger proximity to keys
      const leftIndexTip = this.hands.indexTip('left');
      const rightIndexTip = this.hands.indexTip('right');
      
      let touchedKey: KeypadKey | null = null;
      
      // Check left hand
      if (leftIndexTip) {
        try {
          const leftTouch = keypad.checkTouchInteraction(leftIndexTip);
          if (leftTouch) {
            touchedKey = leftTouch;
            keypad.setHoveredKey(leftTouch);
          }
        } catch (error) {
          logError(error, 'FeedControls.keypad.leftTouch');
        }
      }
      
      // Check right hand (right hand takes priority if both are touching)
      if (rightIndexTip) {
        try {
          const rightTouch = keypad.checkTouchInteraction(rightIndexTip);
          if (rightTouch) {
            touchedKey = rightTouch;
            keypad.setHoveredKey(rightTouch);
          }
        } catch (error) {
          logError(error, 'FeedControls.keypad.rightTouch');
        }
      }
      
      if (touchedKey) {
        // Finger is touching a key - mark UI as active and block 3D interaction
        this.uiActive = true;
        this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
        
        // ENHANCED: Immediate press on pinch (no hold time required)
        const isPinching = this.hands.state[side].pinch;
        if (isPinching) {
          try {
            // Check if key can be pressed (debounce check)
            if (keypad.canPressKey && keypad.canPressKey(touchedKey)) {
              // Pinch detected while touching key - immediate press
              keypad.handleKeyPress(touchedKey);
              // Reset touch state to allow next press
              keypad.resetTouchState();
            }
          } catch (error) {
            logError(error, 'FeedControls.keypad.handleKeyPress');
          }
        } else {
          // Not pinching - check for hold-based press (fallback)
          try {
            const pressedKey = keypad.checkTouchPress();
            if (pressedKey) {
              keypad.handleKeyPress(pressedKey);
              keypad.resetTouchState();
            }
          } catch (error) {
            logError(error, 'FeedControls.keypad.checkTouchPress');
          }
        }
        
        return; // Block other UI and 3D interaction
      } else {
        // Not touching any key - clear hover and reset touch state
        try {
          keypad.setHoveredKey(null);
          keypad.resetTouchState();
        } catch (error) {
          logError(error, 'FeedControls.keypad.resetState');
        }
      }
    } catch (error) {
      // CRITICAL FIX: Don't crash on keyboard interaction errors
      logError(error, 'FeedControls.keypad.interaction');
    }
    
    // Check multiplayer panel (lower priority than keypad)
    // CRITICAL FIX: Context-aware - only check if UI is active OR far from object
    // This prevents 3D model interference when interacting with UI
    if (multiplayerPanel?.isVisible() && (uiIsActive || farFromObject)) {
      const mpHit = multiplayerPanel.raycastHit(ray);
      
      if (mpHit?.button) {
        // Pointing at a button - set hover and show ray line for visual feedback
        multiplayerPanel.setButtonHover(mpHit.button);
        
        // Show visual ray line from hand to panel
        if (tip && mpHit.point) {
          multiplayerPanel.showRayLine(tip, mpHit.point, this.app.scene);
        }
        
        // CRITICAL FIX: Immediate pinch-to-click (same as auth/music panels)
        // Check if pointing hand is pinching
        const pointingHandPinch = pointingSide === 'right' 
          ? this.hands.state.right.pinch 
          : this.hands.state.left.pinch;
        
        if (pointingHandPinch) {
          // CRITICAL FIX: Debounce rapid clicks to prevent duplicate actions
          if (now - this.mpLastClickTime < this.MP_CLICK_DEBOUNCE_MS) {
            // Too soon since last click - ignore
            return;
          }
          
          // Mark UI as active (prevents 3D model interference)
          this.uiActive = true;
          this.uiActiveUntil = now + this.UI_PRIORITY_DURATION_MS;
          
          // Pinch detected while pointing at button - immediate click
          this.mpLastClickTime = now; // Update debounce timer
          multiplayerPanel.hideRayLine(this.app.scene); // Hide ray before click
          // Fire-and-forget with error handling to prevent freeze
          multiplayerPanel.handleClick(mpHit.button).catch((error) => {
            console.error('[FeedControls] Multiplayer panel click error:', error);
            // Error is logged but doesn't block UI
          });
          return; // Block other UI
        }
        
        // Just hovering - show visual feedback but don't click yet
        return; // Block other UI
      } else {
        // Not pointing at button
        multiplayerPanel.setButtonHover(null);
        multiplayerPanel.hideRayLine(this.app.scene);
        // Clear hover state
        this.mpHoverButton = null;
      }
    } else if (multiplayerPanel) {
      // Panel not visible
      multiplayerPanel.hideRayLine(this.app.scene);
      this.mpHoverButton = null;
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
      if (!line) {
        console.warn(`[FeedControls-Ray] ⚠️ No ray line for ${side} hand`);
        return;
      }
      const pinching = this.hands.state[side].pinch;
      
      // FIX #4: IMPROVED raycast logic for BOTH hands
      // Hide ray only in specific cases:
      // 1. If two-hand transform is active (both hands working together)
      // 2. If this hand is actively grabbing
      // 3. If composing in HUD
      // ALWAYS show ray for non-scrolling hand (e.g., left hand when right hand scrolls)
      
      // Hide if two-hand mode active (both hands are being used for scale/rotate)
      if (this.twoHandActive) {
        line.visible = false;
        return;
      }
      
      // Hide if this specific hand is grabbing
      if (this.grabbing && this.grabSide === side) {
        line.visible = false;
        return;
      }
      
      // Show ray if:
      // - Hand is pinching
      // - Not composing in HUD
      // - Not disarmed (only applies to scrolling hand)
      const show = pinching && !this.hudMgr.isComposing() && 
        !(this.scrollDisarmedThisPinch && this.scrollSide === side);
      
      if (!show) {
        line.visible = false;
        return;
      }

      const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      if (!from) {
        // FIX #4: Debug logging for missing hand position
        if (Math.random() < 0.02) { // 2% of calls
          console.warn(`[FeedControls-Ray] ⚠️ No position for ${side} hand - pinchMid and thumbTip both null`);
        }
        line.visible = false;
        return;
      }

      // FIX #4: Always try to get actual object position first
      // This ensures raycast tracks the 3D geometry correctly
      const to = objPos ? objPos.clone() : from.clone().add(fallbackDir.set(0, 0, -0.6));
      
      // Debug logging for raycast tracking
      if (Math.random() < 0.01) { // 1% of calls
        console.log(`[FeedControls-Ray] ${side} ray: from=(${from.x.toFixed(2)}, ${from.y.toFixed(2)}, ${from.z.toFixed(2)}) to=(${to.x.toFixed(2)}, ${to.y.toFixed(2)}, ${to.z.toFixed(2)})`);
      }
      
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
    
    // FIX #4: Update BOTH hands' raycasts
    update('left', this.leftRay);
    update('right', this.rightRay);
    
    // Update rubber band scroll ray
    this.updateScrollRay(objPos);
  }
  
  private updateScrollRay(objPos: THREE.Vector3 | null) {
    if (!this.scrollRay) {
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
    const side: 'left' | 'right' | null = rp ? 'right' : (lp ? 'left' : null);
    
    // Hide if not pinching or actively grabbing
    if (!side || this.grabbing || this.grabPending) {
      this.scrollRay.visible = false;
      return;
    }
    
    const mid = this.hands.pinchMid(side);
    if (!mid || !objPos) {
      this.scrollRay.visible = false;
      return;
    }
    
    // Check if in scroll zone (far from object)
    const distSurf = this.distanceToObjectSurface(mid);
    const inScrollZone = distSurf == null || distSurf >= TRANSFORM.GRAB_ZONE_DISTANCE;
    
    if (!inScrollZone) {
      // In grab zone - hide scroll ray
      this.scrollRay.visible = false;
      return;
    }
    
    // Show rubber band line from hand to object center with visual feedback
    const pos = (this.scrollRay.geometry as THREE.BufferGeometry).getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    if (pos) {
      const handPos = mid;
      const objCenter = objPos;
      
      // Calculate distance for visual feedback
      const dist = handPos.distanceTo(objCenter);
      const maxDist = 0.5; // Maximum distance for effect
      const elasticFactor = Math.min(dist / maxDist, 1.0);
      
      // Color feedback based on scroll state:
      // Gray (0x888888) = Ready to scroll (not armed yet)
      // Green (0x88ff88) = Armed (will scroll on movement)
      // Yellow (0xffff88) = Scrolling (accumulating movement)
      const baseOpacity = 0.3;
      const stretchOpacity = elasticFactor * 0.3;
      
      if (this.scrollArmed && Math.abs(this.scrollAccum) > 0.001) {
        // Scrolling - yellow
        (this.scrollRay.material as THREE.LineDashedMaterial).color.setHex(0xffff88);
        (this.scrollRay.material as THREE.LineDashedMaterial).opacity = baseOpacity + stretchOpacity + 0.2;
      } else if (this.scrollArmed) {
        // Armed - green
        (this.scrollRay.material as THREE.LineDashedMaterial).color.setHex(0x88ff88);
        (this.scrollRay.material as THREE.LineDashedMaterial).opacity = baseOpacity + stretchOpacity + 0.1;
      } else {
        // Ready - gray
        (this.scrollRay.material as THREE.LineDashedMaterial).color.setHex(0x888888);
        (this.scrollRay.material as THREE.LineDashedMaterial).opacity = baseOpacity + stretchOpacity;
      }
      
      pos.setXYZ(0, handPos.x, handPos.y, handPos.z);
      pos.setXYZ(1, objCenter.x, objCenter.y, objCenter.z);
      pos.needsUpdate = true;
      (this.scrollRay as any).computeLineDistances?.(); // Update dashes for new positions
      this.scrollRay.visible = true;
    }
  }

  // Anti-spam: Track pinch events to prevent rapid-fire crashes
  private lastPinchStartTime = 0;
  private pinchStartCount = 0;
  private readonly PINCH_RATE_LIMIT_MS = 100; // Minimum 100ms between pinch starts
  private readonly MAX_PINCH_BURST = 3; // Max 3 pinches in quick succession

  // ---------- pinch lifecycle / feed scroll ----------
  private onPinchStart(side: 'left' | 'right') {
    const pinchNow = performance.now();
    
    // ANTI-SPAM: Rate limit rapid pinch starts to prevent crashes
    if (pinchNow - this.lastPinchStartTime < this.PINCH_RATE_LIMIT_MS) {
      this.pinchStartCount++;
      if (this.pinchStartCount > this.MAX_PINCH_BURST) {
        console.warn(`[FeedControls] ⚠️ Pinch rate limit exceeded - ignoring rapid pinch`);
        return; // Ignore this pinch to prevent crash
      }
    } else {
      this.pinchStartCount = 0; // Reset counter after cooldown
    }
    this.lastPinchStartTime = pinchNow;
    
    // CRITICAL: After tutorial completion, FeedControls is the ONLY handler
    // Only block if tutorial is actively handling grab/scroll steps
    if (this.isTutorialActive() && this.onboardingTutorial) {
      // Tutorial is active - check if it's handling grab/scroll
      if (this.onboardingTutorial.isGrabStepActive()) {
        // Tutorial is handling grab - disable FeedControls grab
        console.log('[FeedControls] Tutorial grab active - blocking FeedControls');
        return;
      }
      if (this.onboardingTutorial.isScrollStepActive()) {
        // Tutorial is handling scroll - disable FeedControls scroll
        console.log('[FeedControls] Tutorial scroll active - blocking FeedControls');
        return;
      }
      // For other tutorial steps, allow FeedControls to work normally
    } else {
      // Tutorial is NOT active - ensure scroll is enabled
      if (Math.random() < 0.1) { // Log 10% of time
        console.log(`[FeedControls] Tutorial NOT active - enabling scroll for ${side} hand`);
      }
    }
    
    // UNIFIED INTERACTION SYSTEM: Check UI first, then 3D
    // CRITICAL: UI ALWAYS has priority - if UI is hit, block all 3D interactions
    try {
      const interaction = this.performUnifiedInteraction(side, true); // requirePinch = true for actual interaction
      if (interaction.handled && interaction.target === 'ui') {
        // UI interaction handled - block 3D completely
        return;
      }
      // No UI hit - continue to 3D interactions below
    } catch (error) {
      logError(error, 'FeedControls.unifiedInteraction');
    }
    
    // Also check if UI is in active state (recently interacted with)
    if (this.isUIActive()) {
      // UI was recently active - block 3D to prevent interference
      return;
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
    this.scrollSide = undefined; // Reset scrolling hand on new pinch

    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) {
      this.twoHandActive = false;
      return;
    }

    // RESTORED: Improved grab detection - more lenient and reliable
    // Grab should work from any reasonable distance, not just close
    const objPosNow = this.store.getObjectWorldPos();
    const objExists = !!this.store.getObject();
    const pinch = this.hands.pinchMid(side);
    
    if (objExists && objPosNow && pinch) {
      // Calculate distance to object
      const d = this.distanceToObjectSurface(pinch);
      
      // RESTORED: More lenient grab - works from further away
      // Instant grab if very close (10cm)
      if (d != null && d <= this.INSTANT_GRAB_DIST) {
        console.log(`[Grab] ✅ Instant grab! Distance: ${(d * 100).toFixed(1)}cm`);
        this.grabbing = true;
        this.grabSide = side;
        this.grabOffset.copy(objPosNow).sub(pinch);
        this.store.notify('Grabbed');
        this.scrollDisarmedThisPinch = true;
        return;
      }
      
      // RESTORED: Grab pending for any distance (up to max grab distance)
      // This makes grab much more reliable - user doesn't need to be super close
      if (d == null || d <= this.GRAB_MAX_DIST) {
        // Object exists and within grab range - start grab pending
        console.log(`[Grab] Starting grab pending (distance: ${d ? (d * 100).toFixed(1) : 'unknown'}cm)`);
        this.tryStartGrabPending(side);
        return; // Don't allow scroll when grab is pending
      } else {
        // Too far for grab - allow scroll
        console.log(`[Scroll] Too far for grab (${(d * 100).toFixed(1)}cm) - scroll zone active`);
      }
    } else {
      // No object or distance unknown - allow scroll
      console.log(`[Scroll] No object or distance unknown - scroll zone active`);
    }
  }

  private onPinchEnd(side: 'left' | 'right') {
    // CRITICAL FIX: Handle keypad key press on pinch end (with duration check)
    const multiplayerPanel = (this as any).multiplayerPanel as any | undefined;
    const keypad = multiplayerPanel?.getKeypad?.();
    if (keypad?.isVisible()) {
      // Get the key that was being pressed
      const from = this.hands.pinchMid(side) ?? this.hands.thumbTip(side);
      if (from) {
        const tip = this.hands.indexTip(side);
        const wrist = this.hands.wrist?.(side);
        
        let handDir: THREE.Vector3;
        if (tip && wrist) {
          handDir = tip.clone().sub(wrist).normalize();
        } else if (tip) {
          const camPos = new THREE.Vector3();
          this.app.camera.getWorldPosition(camPos);
          handDir = tip.clone().sub(camPos).normalize();
        } else {
          const camPos = new THREE.Vector3();
          this.app.camera.getWorldPosition(camPos);
          handDir = from.clone().sub(camPos).normalize();
        }
        
        const ray = new THREE.Ray(from, handDir);
        const keypadHit = keypad.raycastHit(ray);
        
        if (keypadHit) {
          // Check if this was a valid press (held long enough)
          if (keypad.endKeyPress(keypadHit)) {
            // Valid press - handle it
            keypad.handleKeyPress(keypadHit);
            this.setRayVisible(side, false);
            this.scrollDisarmedThisPinch = true;
            return; // Handled
          }
        }
      }
    }
    
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
    this.scrollSide = undefined; // Clear scrolling hand
    this.lastPinchY = null;
    this.filtPinchY = null;
    this.scrollAccum = 0;
    this.pinchStartAt = null;

    // reset hysteresis when user leaves a gesture interaction
    this.lastStableKind = null;
  }

  private updateScroll(now: number) {
    if (now < this.scrollCooldownUntil) return;
    
    // FIX #1: BLOCK scroll during two-hand rotation/scaling
    // User shouldn't scroll while actively manipulating the model
    if (this.twoHandActive) {
      // CRITICAL: Also disarm scroll and reset state to prevent scroll triggering after two-hand gesture ends
      this.scrollArmed = false;
      this.scrollDisarmedThisPinch = true;
      this.scrollAccum = 0;
      this.lastPinchY = null;
      this.filtPinchY = null;
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }
    
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
    
    // SCROLL HAS PRIORITY: Only block if actively grabbing an object
    // Don't let grab pending interfere - scroll cancels pending grabs automatically
    if (this.grabbing) {
      // Actively grabbing - block scroll
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    
    // Allow scrolling with either hand, prefer right hand
    if (!lp && !rp) {
      // Reset scroll state when no pinch
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollArmed = false;
      this.scrollSide = undefined; // Clear scrolling hand
      if (this.scrollRay) this.scrollRay.visible = false;
      return;
    }
    
    // Prefer right hand, fallback to left
    const side: 'left' | 'right' = rp ? 'right' : 'left';
    
    // Track which hand is scrolling (only set when armed)
    if (this.scrollArmed) {
      this.scrollSide = side;
    }

    // CRITICAL FIX: Block scroll if disarmed during this pinch OR during transform cooldown
    // This prevents scroll from triggering after two-hand transform ends
    if (this.scrollDisarmedThisPinch || now < this.transformEndCooldownUntil) {
      if (this.scrollRay) this.scrollRay.visible = false;
      // Reset scroll tracking while blocked
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollAccum = 0;
      return;
    }
    
    const mid = this.hands.pinchMid(side);
    if (!mid) return;
    
    // CRITICAL: Scroll activates after short hold time (50ms)
    // This gives us time to detect scroll vs grab intent
    if (this.pinchStartAt && now - this.pinchStartAt < this.SCROLL_MIN_HOLD_MS) {
      // During hold period, initialize tracking but don't scroll yet
      const y = mid.y;
      if (this.lastPinchY == null && y != null) {
        this.lastPinchY = y;
        this.filtPinchY = y;
      }
      return;
    }
    
    // SIMPLIFIED SCROLL ARMING: Arm after hold time - SCROLL HAS PRIORITY
    // FIX: Don't arm if we're in transform cooldown period
    if (!this.scrollArmed && !this.grabbing && now >= this.transformEndCooldownUntil) {
      this.scrollArmed = true;
      console.log(`[MainFeed-Scroll] ✅ Armed after hold time (${this.SCROLL_MIN_HOLD_MS}ms)`);
      
      // Cancel any pending grab - scroll has priority
      if (this.grabPending) {
        console.log(`[MainFeed-Scroll] Canceling grab pending - scroll has priority`);
        this.cancelGrabPending();
      }
      
      // Initialize tracking
      const y = mid.y;
      if (this.lastPinchY == null && y != null) {
        this.lastPinchY = y;
        this.filtPinchY = y;
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
    
    // Accumulate all movements once scroll is armed
    this.scrollAccum += dy;
    
    // Debug: log accumulation progress (more frequent for debugging)
    if (Math.random() < 0.2) { // 20% of calls
      const context = this.isTutorialActive() ? 'Tutorial' : 'MainFeed';
      console.log(`[${context}-Scroll] Accumulating: dy=${(dy * 100).toFixed(2)}cm, total=${(this.scrollAccum * 100).toFixed(2)}cm, threshold=${(this.SCROLL_DISP * 100).toFixed(2)}cm`);
    }
    
    // Trigger scroll when threshold reached
    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP) {
      const dir = this.scrollAccum < 0 ? +1 : -1;
      const tutorialActive = this.isTutorialActive();
      const context = tutorialActive ? 'Tutorial' : 'MainFeed';
      const oldIndex = this.store.index;
      const totalItems = this.store.items.length;
      
      // CRITICAL: During tutorial, only allow scrolling to tutorial items (core shapes)
      if (tutorialActive && this.onboardingTutorial) {
        const tutorial = this.onboardingTutorial as any;
        const tutorialItemIndices = tutorial.tutorialItemIndices || [];
        const nextIndex = oldIndex + dir;
        
        // Check if next item is a tutorial item
        if (tutorialItemIndices.length > 0 && !tutorialItemIndices.includes(nextIndex)) {
          // Next item is NOT a tutorial item - block scroll
          console.log(`[Tutorial-Scroll] ⚠️ Blocked scroll to non-tutorial item (index ${nextIndex})`);
          this.scrollAccum = 0; // Reset accumulation
          this.store.notify('Tutorial: Use core shapes only');
          return;
        }
      }
      
      console.log(`[${context}-Scroll] ✅✅✅ TRIGGERING SCROLL!`);
      console.log(`  Direction: ${dir > 0 ? 'Next (+1)' : 'Previous (-1)'}`);
      console.log(`  Accumulation: ${(this.scrollAccum * 100).toFixed(2)}cm`);
      console.log(`  Current index: ${oldIndex} / ${totalItems}`);
      console.log(`  Current item: ${this.store.items[oldIndex]?.title || 'unknown'}`);
      
      this.store.next(dir);
      
      // Verify the scroll actually happened
      const newIndex = this.store.index;
      console.log(`  New index: ${newIndex} / ${totalItems}`);
      console.log(`  New item: ${this.store.items[newIndex]?.title || 'unknown'}`);
      console.log(`  Index changed: ${oldIndex !== newIndex ? 'YES ✅' : 'NO ❌'}`);
      
      this.hudMgr.showFor(this.currentModelKey());
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
      
      // GESTURE-BASED SCROLL: Disarm scroll after trigger
      // User must release pinch and make another gesture to scroll again
      this.scrollArmed = false;
      this.scrollDisarmedThisPinch = true;
      console.log(`[${context}-Scroll] ⚠️ Disarmed - release and pinch again to scroll`);
      
      // Visual feedback with naming convention
      const directionLabel = dir > 0 ? 'Next' : 'Previous';
      this.store.notify(`${context}: ${directionLabel} ⬇️`);
    }
  }

  // ---------- two-hand transform ----------
  private updateTwoHandTransform(dt: number) {
    const lp = this.hands.state.left.pinch,
      rp = this.hands.state.right.pinch;
    if (this.grabPending || this.grabbing) return;
    if (!(lp && rp)) {
      if (this.twoHandActive) {
        this.twoHandActive = false;
        this.rotVel = 0;
        // CRITICAL FIX: Reset scroll state AND add cooldown when exiting two-hand mode
        // This prevents scroll from triggering immediately after releasing rotation/scale
        this.scrollArmed = false;
        this.scrollDisarmedThisPinch = true;
        this.scrollAccum = 0;
        this.lastPinchY = null;
        this.filtPinchY = null;
        this.pinchStartAt = null; // Reset pinch timing
        // Add 500ms cooldown after transform ends to prevent accidental scroll
        this.transformEndCooldownUntil = performance.now() + 500;
        if (this.scrollRay) this.scrollRay.visible = false;
        console.log('[FeedControls] ⚠️ Two-hand transform ended - 500ms cooldown before scroll can activate');
      }
      return;
    }

    const Lp = this.hands.pinchMid('left') ?? this.hands.thumbTip('left');
    const Rp = this.hands.pinchMid('right') ?? this.hands.thumbTip('right');
    if (!(Lp && Rp)) {
      if (this.twoHandActive) {
        this.twoHandActive = false;
        this.rotVel = 0;
        // CRITICAL FIX: Reset scroll state AND add cooldown when hand tracking lost
        this.scrollArmed = false;
        this.scrollDisarmedThisPinch = true;
        this.scrollAccum = 0;
        this.lastPinchY = null;
        this.filtPinchY = null;
        this.pinchStartAt = null; // Reset pinch timing
        // Add 500ms cooldown after transform ends
        this.transformEndCooldownUntil = performance.now() + 500;
        if (this.scrollRay) this.scrollRay.visible = false;
        console.log('[FeedControls] ⚠️ Two-hand transform ended (tracking lost) - 500ms cooldown');
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
      // CRITICAL: Immediately disarm scroll when entering two-hand mode
      this.scrollArmed = false;
      this.scrollDisarmedThisPinch = true;
      this.scrollAccum = 0;
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.pinchStartAt = null; // Reset pinch timing
      if (this.scrollRay) this.scrollRay.visible = false;
      console.log('[FeedControls] ✅ Two-hand mode active - scroll DISABLED');
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
    
    // SIMPLIFIED: Grab works if stationary (no vertical movement for 250ms)
    // Scroll has priority - if scrolling, don't grab
    if (this.scrollArmed) {
      console.log(`[MainFeed-Grab] Not starting - scroll active (scroll has priority)`);
      return;
    }
    
    const objPosNow = this.store.getObjectWorldPos();
    const objExists = !!this.store.getObject();
    
    if (!objExists || !objPosNow) {
      // No object - can't grab
      return;
    }
    
    // Start grab pending - will activate after GRAB_HOLD_MS if stationary
    const context = this.isTutorialActive() ? 'Tutorial' : 'MainFeed';
    console.log(`[${context}-Grab] Starting grab pending (will activate after ${this.HOLD_MS}ms if stationary)`);
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
    
    // Cancel if other hand starts pinching (two-hand mode)
    const other = this.grabPendingSide === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) {
      console.log(`[Grab] Grab pending canceled - two-hand mode detected`);
      this.cancelGrabPending();
      return;
    }
    
    // Cancel if hand moves too much (user is trying to scroll, not grab)
    const pinch = this.hands.pinchMid(this.grabPendingSide);
    if (pinch && this.grabPendingStartY != null) {
      const dy = Math.abs(pinch.y - this.grabPendingStartY);
      if (dy > this.PENDING_CANCEL_MOVE) {
        console.log(`[Grab] Grab pending canceled - hand moved ${(dy * 100).toFixed(1)}cm (threshold: ${(this.PENDING_CANCEL_MOVE * 100).toFixed(1)}cm)`);
        this.cancelGrabPending();
        return;
      }
    }
    
    // Cancel if scrolling starts (scroll has priority)
    if (this.scrollArmed) {
      console.log(`[MainFeed-Grab] Pending canceled - scroll started (scroll has priority)`);
      this.cancelGrabPending();
      return;
    }
  }
  private updateGrabDrag() {
    // CRITICAL: UI has priority - block grab if UI is active
    if (this.isUIActive()) {
      if (this.grabbing) {
        this.grabbing = false;
        this.grabSide = null;
        this.store.notify('Grab canceled (UI active)');
      }
      return;
    }
    
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
      
      // FIX: Direct position update without lerp feedback loop
      // The lerp was creating a feedback loop: lerping from current position creates lag/stutter
      // Instead, directly set to target position for immediate, smooth response
      const targetPos = this.grabOffset.clone().add(mid);
      this.store.setPosition(targetPos);
      
      // Debug: log position updates (throttled for performance)
      if (Math.random() < 0.1) { // 10% of calls
        console.log(`[Grab] Moving object: hand=${mid.toArray().map(v => v.toFixed(3)).join(',')}, offset=${this.grabOffset.toArray().map(v => v.toFixed(3)).join(',')}, targetPos=${targetPos.toArray().map(v => v.toFixed(3)).join(',')}, currentObjPos=${objPos.toArray().map(v => v.toFixed(3)).join(',')}`);
      }
    } catch (error) {
      // If any error occurs, cancel grab to prevent freeze
      logError(error, 'FeedControls.updateGrabDrag');
      this.grabbing = false;
      this.grabSide = null;
    }
  }

  // helpers
  // CRITICAL FIX: Enhanced null safety and error handling
  private distanceToObjectSurface(worldPoint: THREE.Vector3): number | null {
    if (!worldPoint) return null;
    
    try {
      const info = this.store.getObjectBounds();
      if (!info || !info.center || typeof info.radius !== 'number') return null;
      
      const { center, radius } = info;
      const distCenter = worldPoint.distanceTo(center);
      return Math.max(0, distCenter - (radius + TRANSFORM.SURFACE_OFFSET));
    } catch (error) {
      logError(error, 'FeedControls.distanceToObjectSurface');
      return null;
    }
  }
  private currentModelKey(): string {
    const anyStore = this.store as any;
    if (typeof anyStore.getCurrentKey === 'function') return String(anyStore.getCurrentKey());
    return 'default';
  }
}

export default FeedControls;

