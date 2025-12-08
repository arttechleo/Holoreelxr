// src/ui/OnboardingTutorial.ts
import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { FeedStore } from '../feed/FeedStore';
import { logError } from '../utils/errors';
import { CONTROLS } from '../config/constants';
import { logger } from '../config/production';
import { TutorialStep, createDefaultTutorialSteps } from './tutorial/TutorialSteps';
import { TutorialPanel } from './tutorial/TutorialPanel';
import { getVideoManager, resolveVideoUrl } from './tutorial/VideoManager';
import { USE_GESTURE_POSTERS_INSTEAD_OF_VIDEO } from './tutorial/TutorialConfig';

export class OnboardingTutorial {
  private group = new THREE.Group()
  private currentStepIndex = 0;
  private originalFeedIndex: number = 0;
  private firstNonTutorialIndex: number = 0;
  
  // Tutorial steps - loaded from module
  private steps: TutorialStep[] = createDefaultTutorialSteps();

  // Tutorial panel - handles canvas drawing
  private panelRenderer: TutorialPanel;
  private panel?: THREE.Mesh;
  private hands: HandEngine;
  private store: FeedStore;
  private onComplete?: () => void;
  tutorialItemIndices: number[] = []; // Made public for FeedControls to check
  private isLoading = false;
  private interactionMonitorInterval: number | null = null;
  private twoHandCheckInterval: number | null = null;
  private grabCheckInterval: number | null = null;
  private feedControls: any = null;
  private currentGestureHandlers: Array<{ event: string; handler: () => void }> = [];
  private progressPercentage: number = 0;
  private lastLoggedProgress: number = -1; // Track last logged progress to avoid spam
  private readonly AUTO_ADVANCE_DELAY_MS = 2600;
  private buttonRegions: { prev: { x: number; y: number; w: number; h: number }; next: { x: number; y: number; w: number; h: number }; skip: { x: number; y: number; w: number; h: number } } | null = null;
  private hoveredButton: 'prev' | 'next' | 'skip' | null = null;
  private buttonLastClickTime = new Map<'prev' | 'next' | 'skip', number>(); // Debouncing
  private rotationInitialValue: number | null = null;
  private scaleInitialValue: number | null = null;
  private userHasInteracted = false; // Track if user has interacted with model
  private modelLoaded = false;
  
  // Look-at-once-then-lock behavior
  private hasAlignedOnce = false;
  private lockedRotation: THREE.Euler | null = null;
  
  // EXACT COPY OF FEEDCONTROLS GRAB SYSTEM - proven to work!
  private isGrabbing: boolean = false;
  private grabHand: 'left' | 'right' | null = null;
  private grabOffset: THREE.Vector3 = new THREE.Vector3();
  private grabStartTime: number = 0;
  private grabStartPosition: THREE.Vector3 | null = null;
  private grabStepIndex: number = -1;
  private grabHasMoved: boolean = false;
  private grabEventHandlers: Array<{ event: string; handler: () => void }> = [];
  private tutorialCompleted: boolean = false; // CRITICAL: Flag to completely disable tutorial handlers
  
  // EXACT COPY OF FEEDCONTROLS SCROLL SYSTEM - proven to work!
  private scrollStepIndex: number = -1;
  private lastPinchY: number | null = null;
  private filtPinchY: number | null = null;
  private scrollAccum = 0;
  private scrollCooldownUntil = 0;
  private pinchStartAt: number | null = null;
  private scrollArmed = false;
  private scrollDisarmedThisPinch = false;
  private lastScrollIndex: number = -1;
  
  // Scroll constants mirror FeedControls (both flows stay in sync)
  private readonly SCROLL_MIN_HOLD_MS = CONTROLS.SCROLL_MIN_HOLD_MS;
  private readonly SCROLL_DISP = CONTROLS.SCROLL_DISPLACEMENT;
  private readonly SCROLL_COOLDOWN_MS = CONTROLS.SCROLL_COOLDOWN_MS;
  private readonly SCROLL_VEL_MIN = CONTROLS.SCROLL_MIN_VELOCITY;
  // Note: SCROLL_IN_AIR_DISTANCE and SCROLL_START_DISTANCE removed from CONTROLS
  private readonly SCROLL_IN_AIR_DIST = 0.15; // 15cm away from object
  private readonly SCROLL_START_FAR = 0.3; // 30cm to start scrolling
  private readonly LPF_SCROLL_ALPHA = CONTROLS.SCROLL_LPF_ALPHA;
  
  // Old interval-based system (to be removed)
  private tutorialGrabActive: boolean = false;
  private tutorialGrabSide: 'left' | 'right' | null = null;
  private tutorialGrabOffset: THREE.Vector3 = new THREE.Vector3();
  private tutorialGrabStartTime: number | null = null;
  private tutorialGrabStartPosition: THREE.Vector3 | null = null;
  private tutorialGrabUpdateInterval: number | null = null;
  private tutorialGrabMonitorInterval: number | null = null;
  private rotationInitTimeout: number | null = null;
  private scaleInitTimeout: number | null = null;
  private completionTimeout: number | null = null;
  private postCompletionCheckTimeout: number | null = null;

  constructor(scene: THREE.Scene, hands: HandEngine, store: FeedStore, feedControls?: any) {
    this.hands = hands;
    this.store = store;
    this.feedControls = feedControls;
    
    // Initialize tutorial panel renderer
    this.panelRenderer = new TutorialPanel();
    
    const geo = new THREE.PlaneGeometry(0.7, 0.4);
    const mat = new THREE.MeshBasicMaterial({
      map: this.panelRenderer.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      opacity: 1.0,
    });
    
    (this.group as any).panelMaterial = mat;
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.position.set(0, 0.4, 0);
    this.group.add(this.panel);
    
    scene.add(this.group);
    
    // Preload all tutorial videos in the background
    this.preloadTutorialVideos();
  }
  
  /**
   * Preload all tutorial videos upfront for instant playback.
   * Gathers all videoSrc values from all steps and preloads them immediately.
   * 
   * If poster fallback is enabled, this does nothing (no videos needed).
   */
  private async preloadTutorialVideos(): Promise<void> {
    // If using posters, skip video preloading entirely
    if (USE_GESTURE_POSTERS_INSTEAD_OF_VIDEO) {
      console.log(`[OnboardingTutorial] Using poster fallback - skipping video preload`);
      return;
    }
    
    // Gather all video sources from all steps
    const videoSources = this.steps
      .map(step => step.videoSrc)
      .filter((src): src is NonNullable<typeof src> => !!src);
    
    if (videoSources.length === 0) {
      console.log(`[OnboardingTutorial] No videos to preload`);
      return;
    }
    
    const videoManager = getVideoManager();
    const t0 = performance.now();
    console.log(`[OnboardingTutorial] Preloading ${videoSources.length} tutorial videos...`);
    
    try {
      await videoManager.preloadAll(videoSources);
      const t1 = performance.now();
      console.log(`[OnboardingTutorial] ✅ All tutorial videos preloaded (${(t1 - t0).toFixed(2)}ms)`);
      
      // Log which format was chosen for each video
      videoSources.forEach(source => {
        const resolvedUrl = resolveVideoUrl(source);
        const format = resolvedUrl.endsWith('.webm') ? 'WebM' : 'MP4';
        console.log(`[OnboardingTutorial] Video resolved to ${format}: ${resolvedUrl}`);
      });
    } catch (error) {
      console.error(`[OnboardingTutorial] Error preloading tutorial videos:`, error);
    }
  }

  /**
   * Ensure video for a specific step is preloaded.
   * Since we now preload all videos upfront, this mainly checks if the video is ready.
   * This is called when showing a step to ensure its video is ready.
   */
  private async ensureVideoForStep(index: number): Promise<void> {
    // If using posters, skip video loading
    if (USE_GESTURE_POSTERS_INSTEAD_OF_VIDEO) {
      return;
    }

    const videoManager = getVideoManager();
    const step = this.steps[index];
    
    if (!step?.videoSrc) {
      return; // No video for this step
    }

    const resolvedUrl = resolveVideoUrl(step.videoSrc);
    const t0 = performance.now();
    console.log(`[OnboardingTutorial] ensureVideoForStep: step=${step.id}, resolvedUrl=${resolvedUrl}, t=${t0.toFixed(2)}ms`);

    // Check if video is already ready (should be, since we preload all upfront)
    if (videoManager.isReady(step.videoSrc)) {
      const t1 = performance.now();
      console.log(`[OnboardingTutorial] ✅ Video already ready for step ${step.id}: ${(t1 - t0).toFixed(2)}ms`);
      return;
    }

    // If not ready, try to preload it (shouldn't happen if preloadTutorialVideos worked)
    try {
      await videoManager.preloadAll([step.videoSrc]);
      const t1 = performance.now();
      console.log(`[OnboardingTutorial] ✅ Video ready for step ${step.id}: ${(t1 - t0).toFixed(2)}ms`);
    } catch (error) {
      console.error(`[OnboardingTutorial] Error ensuring video for step ${step.id}:`, error);
    }
  }
  
  setFeedControls(controls: any) {
    this.feedControls = controls;
  }
  
  /**
   * Preload the Gaussian splat item in the background.
   * Called on the last two tutorial steps to ensure it's ready when tutorial ends.
   */
  private preloadGaussianSplat(): void {
    // Find the Gaussian splat item in the feed
    const gaussianSplatItem = this.store.items.find(item => item.type === 'gaussianSplat');
    
    if (!gaussianSplatItem) {
      console.warn('[OnboardingTutorial] No Gaussian splat item found in feed');
      return;
    }
    
    const itemIndex = this.store.items.indexOf(gaussianSplatItem);
    console.log(`[OnboardingTutorial] Preloading Gaussian splat at index ${itemIndex}: ${gaussianSplatItem.title || gaussianSplatItem.id}`);
    
    // Use FeedStore's preloadRange or schedulePreload method
    // Fire-and-forget: don't block tutorial UI
    if (typeof (this.store as any).schedulePreload === 'function') {
      (this.store as any).schedulePreload(itemIndex).catch((err: any) => {
        console.warn('[OnboardingTutorial] Error preloading Gaussian splat:', err);
      });
    } else if (typeof (this.store as any).preloadRange === 'function') {
      (this.store as any).preloadRange(itemIndex, 1).catch((err: any) => {
        console.warn('[OnboardingTutorial] Error preloading Gaussian splat:', err);
      });
    } else {
      console.warn('[OnboardingTutorial] FeedStore does not have preload methods available');
    }
  }
  
  /**
   * Check if tutorial is currently visible and active
   * CRITICAL: If tutorial is completed, ALWAYS return false
   */
  isTutorialActive(): boolean {
    if (this.tutorialCompleted) {
      return false; // Tutorial completed - never active
    }
    return this.group.visible && !this.isLoading;
  }
  
  /**
   * Get current tutorial step gesture (if any)
   */
  getCurrentGesture(): string | undefined {
    return this.steps[this.currentStepIndex]?.gesture;
  }
  
  /**
   * Check if we should show ReactionHud for current step
   * Only show for like, heart, repost steps
   */
  shouldShowReactionHud(): boolean {
    if (!this.isTutorialActive()) return true; // Show outside tutorial
    const gesture = this.getCurrentGesture();
    return gesture === 'thumbsup' || gesture === 'heart' || gesture === 'peace';
  }
  
  /**
   * Check if we're currently on the grab step
   * This allows FeedControls to disable its grab system
   * CRITICAL: If tutorial is completed, ALWAYS return false
   */
  isGrabStepActive(): boolean {
    if (this.tutorialCompleted) return false; // Tutorial completed - never active
    if (this.grabStepIndex < 0) return false;
    return this.grabStepIndex === this.currentStepIndex && this.group.visible;
  }
  
  /**
   * Check if we're currently on the scroll step
   * This allows FeedControls to disable its scroll system
   * CRITICAL: If tutorial is completed, ALWAYS return false
   */
  isScrollStepActive(): boolean {
    if (this.tutorialCompleted) return false; // Tutorial completed - never active
    if (this.scrollStepIndex < 0) return false;
    return this.scrollStepIndex === this.currentStepIndex && this.group.visible;
  }
  
  /**
   * Check if we're currently on the rotation step
   * This allows FeedControls to enable rotation transforms
   * CRITICAL: If tutorial is completed, ALWAYS return false
   */
  isRotationStepActive(): boolean {
    if (this.tutorialCompleted) return false; // Tutorial completed - never active
    const currentStep = this.steps[this.currentStepIndex];
    return currentStep?.gesture === 'twohandrotate' && this.group.visible;
  }
  
  /**
   * Check if we're currently on the scale step
   * This allows FeedControls to enable scale transforms
   * CRITICAL: If tutorial is completed, ALWAYS return false
   */
  isScaleStepActive(): boolean {
    if (this.tutorialCompleted) return false; // Tutorial completed - never active
    const currentStep = this.steps[this.currentStepIndex];
    return currentStep?.gesture === 'twohandscale' && this.group.visible;
  }
  
  // ========== NEW FRAME-BASED GRAB SYSTEM ==========
  // Simple, reliable, frame-by-frame updates - no intervals!
  
  private distanceToObjectSurface(worldPoint: THREE.Vector3): number | null {
    const bounds = this.store.getObjectBounds();
    if (!bounds) return null;
    const { center, radius } = bounds;
    const distCenter = worldPoint.distanceTo(center);
    return Math.max(0, distCenter - (radius + 0.04));
  }
  
  // REMOVED: Complex raycasting logic - too unreliable
  // Now using SIMPLE approach: if pinching, grab immediately (no distance check)
  
  /**
   * EXACT COPY OF FEEDCONTROLS GRAB - proven to work!
   * Uses event-based approach: onPinchStart/onPinchEnd + updateGrabDrag
   */
  private setupTutorialGrab() {
    // CRITICAL: Always set up grab handlers - grab works throughout ENTIRE tutorial
    // Clear any existing handlers first
    this.clearTutorialGrabHandlers();
    
    // Hook into pinch events - EXACT same pattern as FeedControls
    const leftPinchStart = () => this.onTutorialPinchStart('left');
    const rightPinchStart = () => this.onTutorialPinchStart('right');
    const leftPinchEnd = () => this.onTutorialPinchEnd('left');
    const rightPinchEnd = () => this.onTutorialPinchEnd('right');
    
    this.hands.on('leftpinchstart', leftPinchStart);
    this.hands.on('rightpinchstart', rightPinchStart);
    this.hands.on('leftpinchend', leftPinchEnd);
    this.hands.on('rightpinchend', rightPinchEnd);
    
    this.grabEventHandlers = [
      { event: 'leftpinchstart', handler: leftPinchStart },
      { event: 'rightpinchstart', handler: rightPinchStart },
      { event: 'leftpinchend', handler: leftPinchEnd },
      { event: 'rightpinchend', handler: rightPinchEnd },
    ];
    
    console.log(`[Tutorial Grab] ✅ Event handlers registered - grab enabled throughout tutorial`);
  }
  
  private clearTutorialGrabHandlers() {
    console.log(`[Tutorial] Clearing ${this.grabEventHandlers.length} tutorial grab handlers`);
    
    // CRITICAL: Remove handlers by reference to ensure they're actually removed
    this.grabEventHandlers.forEach(({ event, handler }) => {
      try {
        this.hands.off(event, handler);
        console.log(`[Tutorial] Removed handler for ${event}`);
      } catch (err) {
        console.error(`[Tutorial] Error removing handler for ${event}:`, err);
      }
    });
    
    // Also try removing by creating new handler references (in case handlers were recreated)
    // This is a safety measure to ensure handlers are removed
    const eventsToRemove = ['leftpinchstart', 'rightpinchstart', 'leftpinchend', 'rightpinchend'];
    eventsToRemove.forEach(event => {
      // Try to remove any handlers that might match our pattern
      // This is a fallback in case handler references don't match
      try {
        // We can't directly access HandEngine's listeners, but we can try to remove
        // by ensuring our handlers are cleared
      } catch (err) {
        // Ignore - this is just a safety measure
      }
    });
    
    this.grabEventHandlers = [];
    console.log(`[Tutorial] ✅ All tutorial grab handlers cleared (${this.grabEventHandlers.length} remaining)`);
  }
  
  private onTutorialPinchStart(side: 'left' | 'right') {
    // CRITICAL: If tutorial is completed, NEVER handle events - let FeedControls handle everything
    if (this.tutorialCompleted) {
      console.log(`[Tutorial] onTutorialPinchStart(${side}) - tutorial completed, returning immediately`);
      return; // Tutorial completed - don't interfere at all
    }
    
    // CRITICAL: Only handle if tutorial is actually active
    // If tutorial is not visible, don't interfere - let FeedControls handle it
    if (!this.group.visible || this.isLoading) {
      console.log(`[Tutorial] onTutorialPinchStart(${side}) - tutorial not visible/loading, returning`);
      return; // Don't consume event - let FeedControls handle it
    }
    
    // Double-check tutorial is actually active
    if (!this.isTutorialActive()) {
      console.log(`[Tutorial] onTutorialPinchStart(${side}) - tutorial not active, returning`);
      return; // Tutorial not active - don't interfere
    }
    
    console.log(`[Tutorial] onTutorialPinchStart(${side}) - tutorial active, handling`);
    
    const now = performance.now();
    const pinch = this.hands.pinchMid(side);
    if (!pinch) return;
    
    const objPos = this.store.getObjectWorldPos();
    const otherSide = side === 'left' ? 'right' : 'left';
    const otherPinching = this.hands.state[otherSide].pinch;
    
    // CRITICAL: Enable grab throughout ENTIRE tutorial (not just grab step)
    // Only disable if two hands pinching (two-hand gesture) or on scroll step and far from object
    if (!otherPinching && objPos) {
      // Check if we're on scroll step and should prioritize scroll
      const dist = this.distanceToObjectSurface(pinch);
      const isScrollStep = this.scrollStepIndex >= 0 && this.scrollStepIndex === this.currentStepIndex;
      
      if (isScrollStep) {
        // On scroll step - completely disable grab, enable scroll only
        console.log(`[Tutorial Scroll] Scroll step active - grab disabled, scroll enabled`);
        this.pinchStartAt = now;
        const y = pinch.y;
        if (y != null) {
          this.lastPinchY = y;
          this.filtPinchY = y;
          this.scrollAccum = 0;
        }
        this.scrollDisarmedThisPinch = false;
        this.scrollArmed = true; // Auto-arm for scroll tutorial
        return; // Don't allow grab at all during scroll step
      } else {
        // NOT on scroll step - enable grab normally
        console.log(`[Tutorial Grab] ✅ Grab enabled! ${side} hand (step: ${this.currentStepIndex})`);
        this.isGrabbing = true;
        this.grabHand = side;
        this.grabOffset.copy(objPos).sub(pinch);
        this.grabStartTime = now;
        this.grabStartPosition = objPos.clone();
        this.grabHasMoved = false;
      }
    }
    
    // Handle SCROLL step initialization (if not already handled above)
    if (this.scrollStepIndex >= 0 && this.scrollStepIndex === this.currentStepIndex && !this.isGrabbing) {
      // Initialize scroll state
      this.pinchStartAt = now;
      const y = pinch.y;
      if (y != null) {
        this.lastPinchY = y;
        this.filtPinchY = y;
        this.scrollAccum = 0;
      }
      this.scrollDisarmedThisPinch = false;
      
      // More lenient distance check for tutorial
      const dist = this.distanceToObjectSurface(pinch);
      if (dist != null && dist >= this.SCROLL_START_FAR) {
        this.scrollArmed = true;
        console.log(`[Tutorial Scroll] Scroll armed! Distance: ${dist.toFixed(3)}m`);
      } else {
        // Even if close, allow scroll to arm after movement (more lenient)
        this.scrollArmed = false;
        console.log(`[Tutorial Scroll] Close to object (${dist?.toFixed(3)}m) - scroll will arm on movement`);
      }
    }
  }
  
  private onTutorialPinchEnd(side: 'left' | 'right') {
    // CRITICAL: If tutorial is completed, NEVER handle events - let FeedControls handle everything
    if (this.tutorialCompleted) {
      return; // Tutorial completed - don't interfere at all
    }
    
    // CRITICAL: Only handle if tutorial is actually active
    if (!this.group.visible || !this.isTutorialActive()) {
      return; // Don't consume event - let FeedControls handle it
    }
    
    if (this.isGrabbing && this.grabHand === side) {
      console.log(`[Tutorial Grab] Pinch ended - placing object`);
      this.checkGrabCompletion();
      this.stopGrab();
    }
    
    // Reset scroll state on pinch end - EXACT same as FeedControls
    if (this.scrollStepIndex >= 0 && this.scrollStepIndex === this.currentStepIndex) {
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollArmed = false;
      this.scrollDisarmedThisPinch = false;
      this.pinchStartAt = null;
    }
  }
  
  /**
   * IMPROVED scroll detection - more responsive for tutorial
   */
  private updateTutorialScroll() {
    const now = performance.now();
    if (now < this.scrollCooldownUntil) return;
    
    // CRITICAL: During scroll step, completely block grab
    // This prevents grab/scroll overlap in tutorial
    if (this.currentStepIndex === this.scrollStepIndex) {
      // Scroll step is active - disable grab completely
      if (this.isGrabbing) {
        console.log(`[Tutorial Scroll] Canceling grab - scroll step active`);
        this.stopGrab();
      }
    } else {
      // Not on scroll step - allow grab to block scroll normally
      if (this.isGrabbing && this.grabHand) {
        // Check if hand has moved significantly - if so, it's a grab, not scroll
        const grabHandPos = this.hands.pinchMid(this.grabHand);
        if (grabHandPos && this.grabStartPosition) {
          const movement = grabHandPos.distanceTo(this.grabStartPosition);
          if (movement > 0.05) { // 5cm movement = definitely grabbing
            return;
          }
        } else {
          return; // Lost tracking, assume grab
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
      return;
    }
    
    // Prefer right hand, fallback to left
    const side: 'left' | 'right' = rp ? 'right' : 'left';
    
    // If scroll was disarmed this pinch, don't scroll
    if (this.scrollDisarmedThisPinch) return;
    
    // Need minimum hold time before scrolling (REDUCED for faster response)
    if (this.pinchStartAt && now - this.pinchStartAt < this.SCROLL_MIN_HOLD_MS) return;
    
    const mid = this.hands.pinchMid(side);
    if (!mid) return;
    
    // More lenient distance check - auto-arm on movement even if close
    const distSurf = this.distanceToObjectSurface(mid);
    
    // Auto-arm scroll if hand is far enough from object OR if we detect vertical movement
    if (!this.scrollArmed) {
      if (distSurf != null && distSurf >= this.SCROLL_START_FAR) {
        this.scrollArmed = true;
        console.log(`[Tutorial Scroll] Armed by distance: ${distSurf.toFixed(3)}m`);
      } else if (this.lastPinchY != null) {
        // Check if we have vertical movement - arm on movement
        const y = mid.y;
        const dy = Math.abs(y - this.lastPinchY);
        if (dy > 0.01) { // 1cm movement = arm scroll
          this.scrollArmed = true;
          console.log(`[Tutorial Scroll] Armed by movement: ${(dy * 100).toFixed(1)}cm`);
        }
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
    
    // Check minimum velocity to avoid jitter (REDUCED threshold)
    if (Math.abs(dy) < this.SCROLL_VEL_MIN) return;
    
    // Accumulate scroll displacement
    this.scrollAccum += dy;
    
    // Trigger scroll when threshold reached (REDUCED threshold)
    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP) {
      const dir = this.scrollAccum < 0 ? +1 : -1;
      
      // CRITICAL: Only scroll within tutorial items - don't scroll to non-tutorial items!
      const currentTutorialIndex = this.tutorialItemIndices.indexOf(this.store.index);
      if (currentTutorialIndex >= 0) {
        const nextTutorialIndex = currentTutorialIndex + dir;
        if (nextTutorialIndex >= 0 && nextTutorialIndex < this.tutorialItemIndices.length) {
          const nextFeedIndex = this.tutorialItemIndices[nextTutorialIndex];
          this.store.index = nextFeedIndex;
          this.store.showCurrent().catch(err => {
            console.error('[Tutorial Scroll] Error loading item:', err);
          });
          
          console.log(`[Tutorial Scroll] ✅ Scrolled! Direction: ${dir > 0 ? 'Next' : 'Previous'}, Tutorial index: ${currentTutorialIndex} → ${nextTutorialIndex}, Feed index: ${this.store.index} → ${nextFeedIndex}`);
          
          // Check if index changed to complete step
          if (this.lastScrollIndex >= 0 && this.store.index !== this.lastScrollIndex) {
            console.log(`[Tutorial Scroll] ✅✅✅ COMPLETED! Index changed from ${this.lastScrollIndex} to ${this.store.index}`);
            
            // Mark step as completed
            if (this.steps[this.scrollStepIndex]) {
              this.steps[this.scrollStepIndex].completed = true;
            }
            this.updatePanel();
            
            // Advance to next step
            if (this.currentStepIndex === this.scrollStepIndex) {
              setTimeout(() => {
                if (this.currentStepIndex === this.scrollStepIndex) {
                  this.nextStep();
                }
              }, 1000);
            }
          }
          
          this.lastScrollIndex = this.store.index;
        } else {
          console.log(`[Tutorial Scroll] Reached end of tutorial items (${currentTutorialIndex} + ${dir} = ${nextTutorialIndex})`);
        }
      } else {
        console.warn(`[Tutorial Scroll] Current index ${this.store.index} is not a tutorial item!`);
      }
      
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS;
    }
  }
  
  /**
   * Update grab and scroll - called every frame
   * CRITICAL: Only active during tutorial - after tutorial, this should NOT interfere
   */
  updateGrab(info?: any) {
    // CRITICAL: If tutorial is completed, NEVER update - let FeedControls handle everything
    if (this.tutorialCompleted) {
      // Stop any active grab/scroll and return immediately
      if (this.isGrabbing) {
        this.stopGrab();
        this.isGrabbing = false;
        this.grabHand = null;
      }
      // Reset scroll state
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollArmed = false;
      return; // Don't interfere with FeedControls
    }
    
    // CRITICAL: Only update if tutorial is actually active
    // If tutorial is not active, don't do anything - let FeedControls handle it
    if (!this.isTutorialActive()) {
      // Tutorial not active - stop any active grab/scroll and return immediately
      if (this.isGrabbing) {
        this.stopGrab();
        this.isGrabbing = false;
        this.grabHand = null;
      }
      // Reset scroll state
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollArmed = false;
      return; // Don't interfere with FeedControls
    }
    
    // CRITICAL: During rotate/scale steps, disable grab/scroll to avoid interference with two-hand gestures
    const isRotateOrScaleStep = this.isRotationStepActive() || this.isScaleStepActive();
    if (isRotateOrScaleStep) {
      // Stop any active grab/scroll during rotate/scale steps
      if (this.isGrabbing) {
        this.stopGrab();
        this.isGrabbing = false;
        this.grabHand = null;
      }
      // Reset scroll state
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollArmed = false;
      return; // Let FeedControls handle two-hand transforms exclusively
    }
    
    // Update scroll if on scroll step
    if (this.scrollStepIndex >= 0 && this.scrollStepIndex === this.currentStepIndex) {
      this.updateTutorialScroll();
    }
    
    // CRITICAL: Update grab throughout ENTIRE tutorial (not just grab step)
    // This allows users to move objects at any time during tutorial
    if (!this.group.visible || this.isLoading) {
      if (this.isGrabbing) {
        this.stopGrab();
      }
      return;
    }
    
    // EXACT same logic as FeedControls.updateGrabDrag
    if (!this.isGrabbing || !this.grabHand) {
      return;
    }
    
    try {
      const other = this.grabHand === 'left' ? 'right' : 'left';
      if (this.hands.state[this.grabHand].pinch && this.hands.state[other].pinch) {
        this.isGrabbing = false;
        this.grabHand = null;
        console.log(`[Tutorial Grab] Canceled - two-hand mode`);
        return;
      }
      if (!this.hands.state[this.grabHand].pinch) {
        this.checkGrabCompletion();
        this.stopGrab();
        return;
      }
      const mid = this.hands.pinchMid(this.grabHand);
      if (!mid) {
        console.log(`[Tutorial Grab] Lost hand tracking, canceling grab`);
        this.checkGrabCompletion();
        this.stopGrab();
        return;
      }
      
      const objPos = this.store.getObjectWorldPos();
      if (!objPos) {
        console.log(`[Tutorial Grab] Object doesn't exist, canceling grab`);
        this.stopGrab();
        return;
      }
      
      // Update position - EXACT same as FeedControls
      const newPos = mid.clone().add(this.grabOffset);
      this.store.setPosition(newPos);
      
      // Check if object has moved enough
      if (this.grabStartPosition && !this.grabHasMoved) {
        const movement = objPos.distanceTo(this.grabStartPosition);
        if (movement >= 0.05) { // 5cm
          this.grabHasMoved = true;
          console.log(`[Tutorial Grab] ✅ Object moved ${(movement * 100).toFixed(1)}cm`);
        }
      }
    } catch (error) {
      console.error('[Tutorial Grab] ERROR:', error);
      this.stopGrab();
    }
  }
  
  private checkGrabCompletion() {
    // Check if we moved enough to complete the step
    // Always check final position on release, regardless of grabHasMoved flag
    if (this.grabStartPosition) {
      const currentPos = this.store.getObjectWorldPos();
      if (currentPos) {
        const movement = currentPos.distanceTo(this.grabStartPosition);
        const MIN_MOVEMENT = 0.05; // 5cm
        if (movement >= MIN_MOVEMENT) {
          console.log(`[Tutorial Grab] ✅✅✅ COMPLETED! Moved ${(movement * 100).toFixed(1)}cm and placed object`);
          
          // Mark step as completed
          if (this.steps[this.grabStepIndex]) {
            this.steps[this.grabStepIndex].completed = true;
          }
          this.updatePanel();
          
          // Advance to next step
          if (this.currentStepIndex === this.grabStepIndex) {
            setTimeout(() => {
              if (this.currentStepIndex === this.grabStepIndex) {
                this.nextStep();
              }
            }, 1000); // Small delay to show completion
          }
        } else {
          console.log(`[Tutorial Grab] Object not moved enough (${(movement * 100).toFixed(1)}cm < ${(MIN_MOVEMENT * 100).toFixed(1)}cm) - try again!`);
        }
      }
    }
  }
  
  private stopGrab() {
    if (this.isGrabbing) {
      console.log(`[Tutorial Grab] Stopped`);
    }
    this.isGrabbing = false;
    this.grabHand = null;
    this.grabOffset.set(0, 0, 0);
    this.grabStartTime = 0;
    this.grabStartPosition = null;
    this.grabHasMoved = false;
  }
  
  private startTutorialGrabMonitoring() {
    // Stop any existing grab
    this.stopTutorialGrab();
    
    // Clear any existing monitor interval
    if (this.tutorialGrabMonitorInterval) {
      clearInterval(this.tutorialGrabMonitorInterval);
      this.tutorialGrabMonitorInterval = null;
    }
    
    // Monitor for pinch near object
    const checkInterval = 50; // Check every 50ms for responsiveness
    const GRAB_MAX_DISTANCE = 0.25; // 25cm max distance
    const HOLD_TIME_MS = 150; // 150ms hold to activate grab
    
    let holdStartTime: number | null = null;
    let holdHand: 'left' | 'right' | null = null;
    let lastLogTime = 0;
    
    console.log(`[Tutorial Grab] Starting monitoring...`);
    
    this.tutorialGrabMonitorInterval = window.setInterval(() => {
      try {
        // Check if we should stop monitoring
        if (!this.group.visible || this.isLoading || this.currentStepIndex < 0) {
          this.stopTutorialGrab();
          return;
        }
        
        // If already grabbing, skip detection
        if (this.tutorialGrabActive) {
          return;
        }
        
        // Check both hands for pinch near object
        const leftPinch = this.hands.state.left.pinch;
        const rightPinch = this.hands.state.right.pinch;
        
        // Only allow one hand at a time
        if (leftPinch && rightPinch) {
          holdStartTime = null;
          holdHand = null;
          return;
        }
        
        const side: 'left' | 'right' | null = leftPinch ? 'left' : (rightPinch ? 'right' : null);
        
        if (side) {
          const pinchPos = this.hands.pinchMid(side);
          if (pinchPos) {
            const dist = this.distanceToObjectSurface(pinchPos);
            
            // Debug logging (throttled)
            const now = Date.now();
            if (now - lastLogTime > 1000) { // Log every second
              console.log(`[Tutorial Grab] Monitoring: side=${side}, dist=${dist?.toFixed(3)}m, holdTime=${holdStartTime ? Date.now() - holdStartTime : 0}ms`);
              lastLogTime = now;
            }
            
            if (dist !== null && dist <= GRAB_MAX_DISTANCE) {
              // Within range - start/continue hold timer
              if (holdHand === side) {
                // Same hand still pinching - check if hold time met
                if (holdStartTime !== null && Date.now() - holdStartTime >= HOLD_TIME_MS) {
                  // Activate grab!
                  console.log(`[Tutorial Grab] Hold time met! Activating grab...`);
                  this.activateTutorialGrab(side, pinchPos);
                  return; // Interval will be cleared in activateTutorialGrab
                }
              } else {
                // New hand or different hand - reset timer
                holdStartTime = Date.now();
                holdHand = side;
                console.log(`[Tutorial Grab] Starting hold timer for ${side} hand`);
              }
            } else {
              // Too far - reset
              if (holdHand === side) {
                console.log(`[Tutorial Grab] Too far from object (${dist?.toFixed(3)}m), resetting`);
              }
              holdStartTime = null;
              holdHand = null;
            }
          }
        } else {
          // No pinch - reset
          holdStartTime = null;
          holdHand = null;
        }
      } catch (error) {
        console.error('[Tutorial Grab] Error in monitoring:', error);
        this.stopTutorialGrab();
      }
    }, checkInterval);
  }
  
  private activateTutorialGrab(side: 'left' | 'right', pinchPos: THREE.Vector3) {
    const objPos = this.store.getObjectWorldPos();
    if (!objPos) {
      console.warn(`[Tutorial Grab] Cannot activate - object not found`);
      return;
    }
    
    // Clear monitor interval since we're now actively grabbing
    if (this.tutorialGrabMonitorInterval) {
      clearInterval(this.tutorialGrabMonitorInterval);
      this.tutorialGrabMonitorInterval = null;
    }
    
    this.tutorialGrabActive = true;
    this.tutorialGrabSide = side;
    this.tutorialGrabOffset.copy(objPos).sub(pinchPos);
    this.tutorialGrabStartTime = Date.now();
    this.tutorialGrabStartPosition = objPos.clone();
    
    console.log(`[Tutorial Grab] ✅ Activated! Side: ${side}, Object pos: ${objPos.toArray().map(v => v.toFixed(2)).join(',')}, Offset: ${this.tutorialGrabOffset.toArray().map(v => v.toFixed(2)).join(',')}`);
    
    // Start update loop
    if (this.tutorialGrabUpdateInterval) {
      clearInterval(this.tutorialGrabUpdateInterval);
    }
    this.tutorialGrabUpdateInterval = window.setInterval(() => {
      this.updateTutorialGrab();
    }, 16); // ~60fps
  }
  
  private updateTutorialGrab() {
    try {
      if (!this.tutorialGrabActive || !this.tutorialGrabSide) {
        this.stopTutorialGrab();
        return;
      }
      
      // Check if still pinching
      const stillPinching = this.hands.state[this.tutorialGrabSide].pinch;
      const otherPinching = this.hands.state[this.tutorialGrabSide === 'left' ? 'right' : 'left'].pinch;
      
      // Cancel if other hand pinches (two-hand mode)
      if (stillPinching && otherPinching) {
        console.log(`[Tutorial Grab] Canceled - two-hand mode`);
        this.stopTutorialGrab();
        return;
      }
      
      // Cancel if pinch released
      if (!stillPinching) {
        this.stopTutorialGrab();
        return;
      }
      
      // Get current hand position
      const pinchPos = this.hands.pinchMid(this.tutorialGrabSide);
      if (!pinchPos) {
        console.log(`[Tutorial Grab] Lost hand tracking`);
        this.stopTutorialGrab();
        return;
      }
      
      // Calculate new object position
      const newObjPos = pinchPos.clone().add(this.tutorialGrabOffset);
      
      // Debug logging (throttled)
      if (Math.random() < 0.05) { // 5% of calls
        const currentObjPos = this.store.getObjectWorldPos();
        console.log(`[Tutorial Grab] Updating: hand=${pinchPos.toArray().map(v => v.toFixed(2)).join(',')}, newPos=${newObjPos.toArray().map(v => v.toFixed(2)).join(',')}, current=${currentObjPos?.toArray().map(v => v.toFixed(2)).join(',')}`);
      }
      
      // Update object position directly
      this.store.setPosition(newObjPos);
    } catch (error) {
      console.error('[Tutorial Grab] Error in update:', error);
      this.stopTutorialGrab();
    }
  }
  
  private stopTutorialGrab() {
    if (this.tutorialGrabActive) {
      console.log(`[Tutorial Grab] Stopped`);
    }
    
    this.tutorialGrabActive = false;
    this.tutorialGrabSide = null;
    this.tutorialGrabOffset.set(0, 0, 0);
    this.tutorialGrabStartTime = null;
    this.tutorialGrabStartPosition = null;
    
    if (this.tutorialGrabUpdateInterval) {
      clearInterval(this.tutorialGrabUpdateInterval);
      this.tutorialGrabUpdateInterval = null;
    }
    
    if (this.tutorialGrabMonitorInterval) {
      clearInterval(this.tutorialGrabMonitorInterval);
      this.tutorialGrabMonitorInterval = null;
    }
  }
  
  setOnComplete(callback: () => void) {
    this.onComplete = callback;
  }
  
  setButtonHover(button: 'prev' | 'next' | 'skip' | null) {
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      this.updatePanel();
    }
  }
  
  canClickButton(buttonType: 'prev' | 'next' | 'skip'): boolean {
    const now = performance.now();
    const lastClick = this.buttonLastClickTime.get(buttonType) || 0;
    const debounceTime = 300; // 300ms debounce
    return (now - lastClick) >= debounceTime;
  }
  
  handleButtonClick(buttonType: 'prev' | 'next' | 'skip'): boolean {
    if (!this.group.visible || this.isLoading) return false;
    
    // Debounce check
    if (!this.canClickButton(buttonType)) {
      return false;
    }
    
    // Mark as clicked
    this.buttonLastClickTime.set(buttonType, performance.now());
    
    if (buttonType === 'skip') {
      // Skip tutorial - complete it immediately
      console.log('[Tutorial] ⏭ Skip Tutorial button clicked');
      this.hoveredButton = null;
      this.complete();
      return true;
    } else if (buttonType === 'next') {
      if (this.currentStepIndex < this.steps.length - 1) {
        this.hoveredButton = null;
        this.nextStep();
        return true;
      }
    } else if (buttonType === 'prev') {
      if (this.currentStepIndex > 0) {
        this.hoveredButton = null;
        this.previousStep();
        return true;
      }
    }
    return false;
  }
  
  private previousStep() {
    if (this.currentStepIndex > 0) {
      this.showStep(this.currentStepIndex - 1);
    }
  }
  
  private nextStep() {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.showStep(this.currentStepIndex + 1);
    } else {
      this.complete();
    }
  }

  private findTutorialItems() {
    this.tutorialItemIndices = [];
    this.firstNonTutorialIndex = -1; // Use -1 to indicate "not found yet"
    
    // CRITICAL: Only use core shapes (pyramid, cube/box, sphere) for tutorial
    const allowedShapes: Array<'box' | 'sphere' | 'pyramid'> = ['box', 'sphere', 'pyramid'];
    
    for (let i = 0; i < this.store.items.length; i++) {
      const item = this.store.items[i];
      // Only tutorial items are core shapes (pyramid, cube/box, sphere)
      // This ensures tutorial focuses on basic shapes only
      if (item.type === 'shape' && allowedShapes.includes(item.shape as any)) {
        this.tutorialItemIndices.push(i);
        console.log(`[Tutorial] Found tutorial shape at index ${i}: ${item.shape} (${item.title || item.id})`);
      } else if (this.firstNonTutorialIndex === -1) {
        // First non-tutorial item found (not a core shape)
        this.firstNonTutorialIndex = i;
        console.log(`[Tutorial] First non-tutorial item found at index ${i}: ${item.title || item.id}`);
      }
    }
    
    // Fallback: if no non-tutorial items found, use last tutorial index + 1
    if (this.firstNonTutorialIndex === -1) {
      if (this.tutorialItemIndices.length > 0) {
        this.firstNonTutorialIndex = Math.max(...this.tutorialItemIndices) + 1;
        console.log(`[Tutorial] No non-tutorial items found, using fallback index: ${this.firstNonTutorialIndex}`);
      } else {
        this.firstNonTutorialIndex = 0;
        console.warn(`[Tutorial] No tutorial shapes found in feed!`);
      }
    }
    
    console.log(`[Tutorial] Tutorial items (core shapes only): [${this.tutorialItemIndices.join(', ')}], First non-tutorial: ${this.firstNonTutorialIndex}`);
  }

  private clearGestureHandlers(options?: { preserveTwoHandTracking?: boolean }) {
    const preserveTwoHand = options?.preserveTwoHandTracking === true;
    
    this.currentGestureHandlers.forEach(({ event, handler }) => {
      this.hands.off(event, handler);
    });
    this.currentGestureHandlers = [];
    
    if (this.twoHandCheckInterval && !preserveTwoHand) {
      clearInterval(this.twoHandCheckInterval);
      this.twoHandCheckInterval = null;
    }
    if (this.grabCheckInterval) {
      clearInterval(this.grabCheckInterval);
      this.grabCheckInterval = null;
    }
    // Stop tutorial grab system (both old and new)
    this.stopTutorialGrab();
    this.stopGrab();
    // Reset grab and scroll step indices when leaving steps
    this.grabStepIndex = -1;
    this.scrollStepIndex = -1;
    this.lastScrollIndex = -1;
    if (this.interactionMonitorInterval) {
      clearInterval(this.interactionMonitorInterval);
      this.interactionMonitorInterval = null;
    }
    
    // Clear all timeouts to prevent memory leaks (unless we explicitly preserve them)
    if (this.rotationInitTimeout && !preserveTwoHand) {
      clearTimeout(this.rotationInitTimeout);
      this.rotationInitTimeout = null;
    }
    if (this.scaleInitTimeout && !preserveTwoHand) {
      clearTimeout(this.scaleInitTimeout);
      this.scaleInitTimeout = null;
    }
    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
      this.completionTimeout = null;
    }
    if (this.postCompletionCheckTimeout) {
      clearTimeout(this.postCompletionCheckTimeout);
      this.postCompletionCheckTimeout = null;
    }
    
    // CRITICAL: Only reset rotation/scale initial values if we're NOT preserving them
    if (!preserveTwoHand) {
      this.rotationInitialValue = null;
      this.scaleInitialValue = null;
    }
  }

  // Monitor user interactions with 3D model
  private startInteractionMonitoring() {
    if (this.interactionMonitorInterval) {
      clearInterval(this.interactionMonitorInterval);
    }
    
    this.interactionMonitorInterval = window.setInterval(() => {
      if (!this.group.visible || this.isLoading) return;
      
      // If we're on welcome step and user interacts, advance to rotation
      if (this.currentStepIndex === 0 && !this.userHasInteracted && this.modelLoaded) {
        const twoHandActive = (this.feedControls as any)?.twoHandActive;
        const grabbing = (this.feedControls as any)?.grabbing;
        const leftPinch = this.hands.state.left.pinch;
        const rightPinch = this.hands.state.right.pinch;
        
        // Detect any interaction with the model
        if (twoHandActive || grabbing || (leftPinch && rightPinch)) {
          console.log('[Tutorial] User interaction detected! Advancing to rotation step...');
          this.userHasInteracted = true;
          this.showStep(1); // Go to rotation step
        }
      }
    }, 100);
  }

  private async showStep(index: number) {
    if (index < 0 || index >= this.steps.length) {
      return;
    }
    
    const t0 = performance.now();
    this.currentStepIndex = index;
    const step = this.steps[index];
    
    this.progressPercentage = 0;
    this.lastLoggedProgress = -1; // Reset progress logging
    const isTwoHandTrackingStep = step.gesture === 'twohandrotate' || step.gesture === 'twohandscale';
    this.clearGestureHandlers({ preserveTwoHandTracking: isTwoHandTrackingStep });
    
    console.log(`[TutorialTiming] showStep start: step=${step.id}, index=${index + 1}/${this.steps.length}, t=${t0.toFixed(2)}ms`);
    
    // Preload Gaussian splat on last two steps (N-2 and N-1)
    const isLastTwoSteps = index >= this.steps.length - 2;
    if (isLastTwoSteps) {
      this.preloadGaussianSplat();
    }
    
    // Ensure video is preloaded for this step (only if not using posters)
    await this.ensureVideoForStep(index);
    const t1 = performance.now();
    console.log(`[TutorialTiming] ensureVideoForStep complete: ${(t1 - t0).toFixed(2)}ms`);
    
    this.updatePanel();
    const t2 = performance.now();
    console.log(`[TutorialTiming] updatePanel complete: ${(t2 - t1).toFixed(2)}ms, total=${(t2 - t0).toFixed(2)}ms`);
    
    // Welcome step - just show panel, load first model
    if (step.id === 'welcome') {
      this.group.visible = true;
      this.userHasInteracted = false;
      this.isLoading = true;
      
      // Load first tutorial model
      if (this.tutorialItemIndices.length > 0) {
        try {
          this.store.index = this.tutorialItemIndices[0];
          await this.store.showCurrent();
          this.modelLoaded = true;
          this.isLoading = false;
          
          // Start monitoring for interactions (auto-advance on interaction)
          this.startInteractionMonitoring();
          
          // CRITICAL FIX: Ensure panel is visible and Next button is enabled
          // The Next button should allow manually starting the tutorial
          this.updatePanel();
        } catch (error) {
          logger.error(`[Tutorial] Error loading model:`, error);
          this.isLoading = false;
          // Still show panel even if model fails to load
          this.updatePanel();
        }
      } else {
        // No tutorial items found - show error state
        logger.warn('[Tutorial] No tutorial items found in feed');
        this.isLoading = false;
        this.updatePanel();
      }
      return;
    }
    
    // For scroll step - don't change item, stay on current and allow scrolling
    if (step.id === 'scroll') {
      // Ensure we're on a tutorial item
      const currentTutorialIndex = this.tutorialItemIndices.indexOf(this.store.index);
      if (currentTutorialIndex < 0 && this.tutorialItemIndices.length > 0) {
        // Not on a tutorial item - load the first one
        this.isLoading = true;
        try {
          this.store.index = this.tutorialItemIndices[0];
          await this.store.showCurrent();
          this.modelLoaded = true;
          this.isLoading = false;
        } catch (error) {
          console.error(`[Tutorial] Error loading first tutorial item:`, error);
          this.isLoading = false;
        }
      } else {
        this.modelLoaded = true;
        this.isLoading = false;
      }
      
      this.group.visible = true;
      
      if (step.gesture) {
        this.waitForGesture(step.gesture);
      }
    }
    // For other steps, load appropriate model
    else {
      const tutorialItemIndex = index - 1; // Account for welcome step
      if (tutorialItemIndex >= 0 && tutorialItemIndex < this.tutorialItemIndices.length) {
        const feedIndex = this.tutorialItemIndices[tutorialItemIndex];
        this.isLoading = true;
        
        try {
          this.store.index = feedIndex;
          await this.store.showCurrent();
          this.modelLoaded = true;
          this.isLoading = false;
          
          // Initialize tracking for rotation/scale steps
          // Clear any existing timeouts first
          if (this.rotationInitTimeout) {
            clearTimeout(this.rotationInitTimeout);
            this.rotationInitTimeout = null;
          }
          if (this.scaleInitTimeout) {
            clearTimeout(this.scaleInitTimeout);
            this.scaleInitTimeout = null;
          }
          
          if (step.id === 'rotate') {
            // Reset initial value before scheduling new capture
            this.rotationInitialValue = null;
            console.log('[Tutorial] 🔄 Setting up rotation initial value timeout (500ms delay)');
            this.rotationInitTimeout = window.setTimeout(() => {
              if (this.currentStepIndex === index) { // Only set if still on same step
                this.rotationInitialValue = this.store.rotationY;
                console.log(`[Tutorial] 🔄 Rotation tracking initialized: initial=${this.rotationInitialValue} (${(this.rotationInitialValue * 180 / Math.PI).toFixed(1)}°)`);
              } else {
                console.log(`[Tutorial] 🔄 Rotation initial value timeout fired but step changed (was ${index}, now ${this.currentStepIndex})`);
              }
              this.rotationInitTimeout = null;
            }, 500);
          } else if (step.id === 'scale') {
            this.scaleInitialValue = null;
            this.scaleInitTimeout = window.setTimeout(() => {
              if (this.currentStepIndex === index) { // Only set if still on same step
                this.scaleInitialValue = this.store.scale;
                console.log(`[Tutorial] Scale tracking: initial=${this.scaleInitialValue}`);
              }
              this.scaleInitTimeout = null;
            }, 500);
          }
          
          this.group.visible = true;
          
          if (step.gesture) {
            this.waitForGesture(step.gesture);
          }
        } catch (error) {
          console.error(`[Tutorial] Error loading model:`, error);
          this.isLoading = false;
        }
      }
    }
  }

  private waitForGesture(gesture: string) {
    // CRITICAL: Don't set up gesture handlers if tutorial is completed
    if (this.tutorialCompleted) {
      console.log(`[Tutorial] waitForGesture(${gesture}) - tutorial completed, skipping`);
      return;
    }
    
    if (this.isLoading) {
      // Use window.setTimeout and check if tutorial is still active before retrying
      window.setTimeout(() => {
        if (!this.tutorialCompleted && this.isTutorialActive()) {
          this.waitForGesture(gesture);
        }
      }, 200);
      return;
    }
    
    const preserveTwoHand = gesture === 'twohandrotate' || gesture === 'twohandscale';
    this.clearGestureHandlers({ preserveTwoHandTracking: preserveTwoHand });
    
    const stepIndex = this.currentStepIndex;
    const expectedGesture = this.steps[stepIndex]?.gesture;
    
    if (!expectedGesture) {
      return;
    }
    
    let handlerFired = false;
    
    const handler = () => {
      if (this.isLoading || this.currentStepIndex !== stepIndex || handlerFired) {
        return;
      }
      
      handlerFired = true;
      this.clearGestureHandlers();
      
      if (this.steps[stepIndex]) {
        this.steps[stepIndex].completed = true;
      }
      
      this.updatePanel();
      
      // Automatically advance to next step after completion (with slight pause so it doesn't feel rushed)
      setTimeout(() => {
        if (this.currentStepIndex === stepIndex) {
          this.nextStep();
        }
      }, this.AUTO_ADVANCE_DELAY_MS);
    };
    
    // Rotation detection - monitor actual rotation changes
    if (gesture === 'twohandrotate') {
      console.log('[Tutorial] 🔄 Setting up rotation tracking interval');
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.twoHandCheckInterval) {
            console.log('[Tutorial] 🔄 Clearing rotation interval (step changed or completed)');
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        if (this.rotationInitialValue === null) {
          // Still waiting for initial value to be set (500ms delay)
          return;
        }
        
        const currentRotY = this.store.rotationY;
        let rotDiff = Math.abs(currentRotY - this.rotationInitialValue);
        
        if (rotDiff > Math.PI) {
          rotDiff = 2 * Math.PI - rotDiff;
        }
        
        const REQUIRED_ROTATION = Math.PI / 6; // 30 degrees
        const progress = (rotDiff / REQUIRED_ROTATION) * 100;
        this.progressPercentage = Math.min(100, Math.max(0, progress));
        
        // Log rotation progress every 5% to help debug
        const progressRounded = Math.floor(progress / 5) * 5;
        if (progressRounded > 0 && progressRounded % 10 === 0 && progressRounded !== this.lastLoggedProgress) {
          console.log(`[Tutorial] 🔄 Rotation progress: ${progressRounded}% (${(rotDiff * 180 / Math.PI).toFixed(1)}° / 30°)`);
          this.lastLoggedProgress = progressRounded;
        }
        
        this.updatePanel();
        
        if (rotDiff >= REQUIRED_ROTATION && !handlerFired) {
          console.log(`[Tutorial] ✅ Rotation complete! ${(rotDiff * 180 / Math.PI).toFixed(1)}°`);
          handler();
        }
      }, 100);
    }
    // Scale detection
    else if (gesture === 'twohandscale') {
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.twoHandCheckInterval) {
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        if (this.scaleInitialValue === null) {
          return;
        }
        
        const currentScale = this.store.scale;
        const scaleChange = Math.abs(currentScale - this.scaleInitialValue);
        
        const progress = (scaleChange / 0.2) * 100; // 20% change = 100%
        this.progressPercentage = Math.min(100, Math.max(0, progress));
        this.updatePanel();
        
        if (scaleChange > 0.1 && !handlerFired) {
          console.log(`[Tutorial] ✅ Scale complete! Change: ${(scaleChange * 100).toFixed(1)}%`);
          handler();
        }
      }, 100);
    }
    // Grab detection - EXACT COPY OF FEEDCONTROLS PATTERN
    else if (gesture === 'grab') {
      // Initialize grab system
      this.stopGrab(); // Clear any existing grab
      this.grabStepIndex = stepIndex;
      
      // Verify object exists
      const obj = this.store.getObject();
      const objPos = this.store.getObjectWorldPos();
      const bounds = this.store.getObjectBounds();
      
      console.log(`[Tutorial Grab] ✅ Initialized for step ${stepIndex}`);
      console.log(`  Object exists: ${!!obj}, name: ${obj?.name || 'none'}`);
      console.log(`  Object position: ${objPos?.toArray().map(v => v.toFixed(2)).join(',') || 'null'}`);
      console.log(`  Object bounds: ${bounds ? `center=${bounds.center.toArray().map(v => v.toFixed(2)).join(',')}, radius=${bounds.radius.toFixed(2)}m` : 'null'}`);
      console.log(`  Ready to grab! Pinch to grab (works from any distance)`);
      
      // Setup event handlers - EXACT same pattern as FeedControls
      this.setupTutorialGrab();
    }
    // Scroll detection - EXACT COPY OF FEEDCONTROLS PATTERN
    else if (gesture === 'scroll') {
      // Initialize scroll system
      this.scrollStepIndex = stepIndex;
      
      // CRITICAL: Ensure we're on a tutorial item - if not, load the first one
      const currentTutorialIndex = this.tutorialItemIndices.indexOf(this.store.index);
      if (currentTutorialIndex < 0 && this.tutorialItemIndices.length > 0) {
        // Not on a tutorial item - load the first one
        this.store.index = this.tutorialItemIndices[0];
        this.store.showCurrent().catch(err => {
          console.error('[Tutorial Scroll] Error loading first tutorial item:', err);
        });
      }
      
      this.lastScrollIndex = this.store.index;
      
      // Reset scroll state
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollAccum = 0;
      this.scrollCooldownUntil = 0;
      this.pinchStartAt = null;
      this.scrollArmed = false;
      this.scrollDisarmedThisPinch = false;
      
      console.log(`[Tutorial Scroll] ✅ Initialized for step ${stepIndex}`);
      console.log(`  Current index: ${this.store.index}`);
      console.log(`  Tutorial items: ${this.tutorialItemIndices.join(', ')}`);
      console.log(`  Ready to scroll! Pinch away from object and move UP/DOWN`);
      
      // Scroll logic runs in updateTutorialScroll() called from updateGrab() frame loop
      // Uses EXACT same pattern as FeedControls.updateScroll()
    }
    // Gesture-based detections (thumbsup, heart, peace)
    else if (gesture === 'thumbsup') {
      const thumbsUpHandler = () => {
        if (!handlerFired && this.currentStepIndex === stepIndex) {
          console.log(`[Tutorial] ✅ Thumbs up detected!`);
          handler();
        }
      };
      this.hands.on('thumbsupstart', thumbsUpHandler);
      this.currentGestureHandlers.push({ event: 'thumbsupstart', handler: thumbsUpHandler });
    }
    else if (gesture === 'heart') {
      const heartHandler = () => {
        if (!handlerFired && this.currentStepIndex === stepIndex) {
          console.log(`[Tutorial] ✅ Heart gesture detected!`);
          handler();
        }
      };
      this.hands.on('heartstart', heartHandler);
      this.currentGestureHandlers.push({ event: 'heartstart', handler: heartHandler });
    }
    else if (gesture === 'peace') {
      const peaceHandler = () => {
        if (!handlerFired && this.currentStepIndex === stepIndex) {
          console.log(`[Tutorial] ✅ Peace gesture detected!`);
          handler();
        }
      };
      this.hands.on('peacestart', peaceHandler);
      this.currentGestureHandlers.push({ event: 'peacestart', handler: peaceHandler });
    }
  }

  private updatePanel() {
    const t0 = performance.now();
    const step = this.steps[this.currentStepIndex];
    if (!step) return;
    
    // Use TutorialPanel to render
    // CRITICAL: Pass visibility state to prevent video playback when tutorial is hidden
    const isTutorialVisible = this.group.visible && !this.isLoading && !this.tutorialCompleted;
    this.panelRenderer.render({
      step,
      progressPercentage: this.progressPercentage,
      hoveredButton: this.hoveredButton,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      isTutorialVisible // CRITICAL: Only play videos when tutorial is actually visible
    });
    
    // Update buttonRegions reference
    this.buttonRegions = this.panelRenderer.buttonRegions;
  }

  private complete() {
    // CRITICAL: Stop all grab/scroll activity immediately
    this.stopGrab();
    this.isGrabbing = false;
    this.grabHand = null;
    
    // Reset all scroll state
    this.lastPinchY = null;
    this.filtPinchY = null;
    this.scrollAccum = 0;
    this.scrollArmed = false;
    this.scrollDisarmedThisPinch = false;
    this.pinchStartAt = null;
    
    // Ensure all intervals and timeouts are cleaned up
    this.clearGestureHandlers();
    
    const step = this.steps[this.currentStepIndex];
    if (step) {
      step.completed = true;
    }
    
    this.updatePanel();
    
    // CRITICAL: Clear any existing completion timeout to prevent leaks
    if (this.completionTimeout) {
      clearTimeout(this.completionTimeout);
    }
    
    // Use window.setTimeout and store for cleanup
    this.completionTimeout = window.setTimeout(() => {
      // CRITICAL: Mark tutorial as completed FIRST - this disables all tutorial handlers
      this.tutorialCompleted = true;
      
      // CRITICAL: Pause all videos when tutorial completes
      this.panelRenderer.pauseAllVideos();
      
      // CRITICAL: Hide tutorial and mark as inactive BEFORE navigating
      // This ensures isTutorialActive() returns false immediately
      this.group.visible = false;
      this.isLoading = false; // Ensure loading is false
      
      // Reset all tutorial step indices to ensure checks return false
      this.grabStepIndex = -1;
      this.scrollStepIndex = -1;
      
      // CRITICAL: Remove ALL tutorial event handlers to prevent interference
      // Call multiple times to ensure complete removal
      this.clearTutorialGrabHandlers();
      this.clearTutorialGrabHandlers(); // Double-clear to be sure
      
      // CRITICAL: Also clear all gesture handlers
      this.clearGestureHandlers();
      
      // CRITICAL: Force remove any remaining handlers by trying to remove all possible handlers
      // This is a nuclear option to ensure tutorial handlers are completely gone
      try {
        // Try to remove handlers even if they're not in our list
        // This handles edge cases where handlers might have been recreated
        const testHandler = () => {};
        ['leftpinchstart', 'rightpinchstart', 'leftpinchend', 'rightpinchend'].forEach(event => {
          // We can't directly remove handlers we don't have references to,
          // but we've already cleared our tracked handlers above
        });
      } catch (err) {
        console.warn('[Tutorial] Error in handler cleanup:', err);
      }
      
      // CRITICAL: Reset all state to ensure clean transition
      this.isGrabbing = false;
      this.grabHand = null;
      this.lastPinchY = null;
      this.filtPinchY = null;
      this.scrollAccum = 0;
      this.scrollArmed = false;
      this.scrollDisarmedThisPinch = false;
      this.pinchStartAt = null;
      
      console.log('[Tutorial] ✅✅✅ TUTORIAL COMPLETED - ALL HANDLERS DISABLED');
      console.log(`[Tutorial] tutorialCompleted = ${this.tutorialCompleted}`);
      console.log(`[Tutorial] isTutorialActive() = ${this.isTutorialActive()}, group.visible = ${this.group.visible}, isLoading = ${this.isLoading}`);
      console.log(`[Tutorial] Remaining grabEventHandlers: ${this.grabEventHandlers.length}`);
      console.log(`[Tutorial] All tutorial handlers removed - FeedControls should work normally now`);
      
      // CRITICAL: Verify FeedControls is ready and reset its scroll state
      if (this.feedControls) {
        console.log('[Tutorial] FeedControls reference exists - resetting scroll state for clean transition');
        // Use public method to reset scroll state (proper encapsulation)
        if (typeof (this.feedControls as any).resetScrollState === 'function') {
          (this.feedControls as any).resetScrollState();
          console.log('[Tutorial] FeedControls scroll state reset - ready for main feed scrolling');
          if (typeof (this.feedControls as any).verifyFeaturesEnabled === 'function') {
            (this.feedControls as any).verifyFeaturesEnabled();
          }
        } else {
          console.warn('[Tutorial] FeedControls.resetScrollState() not available - using fallback');
        }
      } else {
        console.warn('[Tutorial] WARNING: FeedControls reference is null!');
      }
      
      // CRITICAL: Ensure firstNonTutorialIndex is valid
      let targetIndex = this.firstNonTutorialIndex;
      if (targetIndex < 0 || targetIndex >= this.store.items.length) {
        // Fallback to original index or 0
        targetIndex = this.originalFeedIndex >= 0 && this.originalFeedIndex < this.store.items.length 
          ? this.originalFeedIndex 
          : 0;
        console.warn(`[Tutorial] Invalid firstNonTutorialIndex (${this.firstNonTutorialIndex}), using fallback: ${targetIndex}`);
      }
      
      // Ensure targetIndex is within bounds
      targetIndex = Math.max(0, Math.min(targetIndex, this.store.items.length - 1));
      
      console.log(`[Tutorial] Navigating to feed index ${targetIndex} (firstNonTutorialIndex: ${this.firstNonTutorialIndex}, items.length: ${this.store.items.length})`);
      
      if (targetIndex >= 0 && targetIndex < this.store.items.length) {
        const item = this.store.items[targetIndex];
        console.log(`[Tutorial] Target item: ${item?.title || item?.id || 'unknown'} (type: ${item?.type || 'unknown'})`);
        
        if (this.store.index !== targetIndex) {
          this.store.index = targetIndex;
          this.store.setTargetTransform(1, 0);
          this.store.showCurrent().catch(err => {
            console.error('[Tutorial] Error showing feed:', err);
            logError(err, 'Tutorial.showCurrent');
          });
        } else {
          // Index is already correct, but ensure content is shown
          console.log(`[Tutorial] Index already correct (${targetIndex}), ensuring content is shown`);
          this.store.showCurrent().catch(err => {
            console.error('[Tutorial] Error showing current feed:', err);
            logError(err, 'Tutorial.showCurrent');
          });
        }

        // Preload the next few GLB models so they appear immediately after the blue sphere
        const preloadStart = targetIndex + 1;
        if (typeof (this.store as any).preloadRange === 'function') {
          (this.store as any).preloadRange(preloadStart, 3);
        }
      } else {
        console.error(`[Tutorial] Invalid targetIndex: ${targetIndex} (items.length: ${this.store.items.length})`);
      }
      
      if (this.onComplete) {
        this.onComplete();
      }
      
      // CRITICAL: Clear any existing post-completion check timeout
      if (this.postCompletionCheckTimeout) {
        clearTimeout(this.postCompletionCheckTimeout);
      }
      
      // CRITICAL: Force a test to verify FeedControls is working
      this.postCompletionCheckTimeout = window.setTimeout(() => {
        console.log('[Tutorial] Post-completion check:');
        console.log(`  tutorialCompleted: ${this.tutorialCompleted}`);
        console.log(`  isTutorialActive(): ${this.isTutorialActive()}`);
        console.log(`  group.visible: ${this.group.visible}`);
        console.log(`  grabEventHandlers.length: ${this.grabEventHandlers.length}`);
        console.log(`  FeedControls exists: ${!!this.feedControls}`);
        if (this.feedControls && typeof (this.feedControls as any).verifyFeaturesEnabled === 'function') {
          (this.feedControls as any).verifyFeaturesEnabled();
        }
        this.postCompletionCheckTimeout = null; // Clear reference after execution
      }, 100);
      
      this.completionTimeout = null; // Clear reference after execution
    }, 2000);
  }

  // Update panel position - place BEHIND the 3D model, rotated 90° to face user
  // Look-at-once-then-lock: Align to user once when first shown, then lock rotation
  updatePosition(objectPosition: THREE.Vector3, cameraPosition: THREE.Vector3) {
    if (!this.group.visible) return;
    
    // Position panel BEHIND the object (negative Z direction)
    const behindOffset = new THREE.Vector3(0, 0, -0.6); // 0.6m behind the object
    const panelPos = objectPosition.clone().add(behindOffset);
    panelPos.y = objectPosition.y + 0.2; // Slightly above object center
    
    this.group.position.copy(panelPos);
    
    // Look-at-once-then-lock behavior
    if (!this.hasAlignedOnce) {
      // First time: look at camera to align for readability
      this.group.lookAt(cameraPosition);
      // Lock this rotation
      this.lockedRotation = this.group.rotation.clone();
      this.hasAlignedOnce = true;
    } else {
      // After first alignment: use locked rotation (world-locked)
      if (this.lockedRotation) {
        this.group.rotation.copy(this.lockedRotation);
      }
    }
  }

  async show(camera: THREE.Camera) {
    // CRITICAL: Reset completion flag when starting tutorial
    this.tutorialCompleted = false;
    
    // Reset alignment state when showing tutorial
    this.hasAlignedOnce = false;
    this.lockedRotation = null;
    
    this.currentStepIndex = 0;
    this.progressPercentage = 0;
    this.steps.forEach(step => step.completed = false);
    
    if ((this.group as any).panelMaterial) {
      (this.group as any).panelMaterial.opacity = 1.0;
    }
    
    this.originalFeedIndex = this.store.index;
    this.findTutorialItems();
    
    // CRITICAL: Set up grab handlers immediately - grab works throughout ENTIRE tutorial
    this.setupTutorialGrab();
    
    this.group.visible = true;
    
    // Initial position (will be updated by updatePosition)
    // CRITICAL FIX: World-locked initial position (not camera-relative)
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(pos);
    camera.getWorldDirection(dir);
    this.group.position.copy(pos.add(dir.multiplyScalar(1.5)));
    this.group.position.y += 0.3;
    // Initial rotation will be set by updatePosition with look-at-once behavior
    
    await this.showStep(0);
  }

  hide() {
    // CRITICAL: Pause all videos when tutorial is hidden
    this.panelRenderer.pauseAllVideos();
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.group.visible;
  }
  
  // Raycast hit test for button clicks (hand gesture based)
  raycast(ray: THREE.Ray): { button?: 'prev' | 'next' | 'skip' } | null {
    if (!this.group.visible || !this.panel) {
      return null;
    }
    
    try {
      const normalizedDir = ray.direction.clone().normalize();
      const raycaster = new THREE.Raycaster(ray.origin, normalizedDir);
      raycaster.far = 10;
      
      const intersects = raycaster.intersectObject(this.panel, false);
      
      if (!intersects || intersects.length === 0) {
        return null;
      }
      
      const intersect = intersects[0];
      if (!intersect.uv) {
        return null;
      }
      
      const uv = intersect.uv;
      const x = uv.x * this.panelRenderer.canvas.width;
      const y = (1 - uv.y) * this.panelRenderer.canvas.height;
      
      if (this.buttonRegions) {
        // Check skip button first (top priority)
        const skip = this.buttonRegions.skip;
        if (skip && x >= skip.x && x <= skip.x + skip.w &&
            y >= skip.y && y <= skip.y + skip.h) {
          return { button: 'skip' };
        }
        
        // Check previous button
        const prev = this.buttonRegions.prev;
        if (prev && x >= prev.x && x <= prev.x + prev.w &&
            y >= prev.y && y <= prev.y + prev.h &&
            this.currentStepIndex > 0) {
          return { button: 'prev' };
        }
        
        // Check next button
        const next = this.buttonRegions.next;
        if (next && x >= next.x && x <= next.x + next.w &&
            y >= next.y && y <= next.y + next.h &&
            this.currentStepIndex < this.steps.length - 1) {
          return { button: 'next' };
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[Tutorial] Raycast error:`, error);
      return null;
    }
  }
  
  /**
   * Check touch-based interaction for buttons
   */
  checkTouchInteraction(indexTip: THREE.Vector3): 'prev' | 'next' | 'skip' | null {
    if (!this.group.visible || !this.panel || !indexTip) return null;
    
    try {
      // Convert finger position to panel local space
      const localPos = new THREE.Vector3();
      this.group.worldToLocal(localPos.copy(indexTip));
      
      // Check distance to panel plane
      const distToPlane = Math.abs(localPos.z);
      if (distToPlane > 0.1) return null; // 10cm threshold
      
      // Convert to canvas coordinates
      const u = (localPos.x / 0.7) + 0.5;
      const v = 0.5 - (localPos.y / 0.4);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      
      const px = u * this.panelRenderer.canvas.width;
      const py = v * this.panelRenderer.canvas.height;
      
      if (this.buttonRegions) {
        // Check skip button first
        const skip = this.buttonRegions.skip;
        if (skip && px >= skip.x && px <= skip.x + skip.w &&
            py >= skip.y && py <= skip.y + skip.h) {
          return 'skip';
        }
        
        // Check previous button
        const prev = this.buttonRegions.prev;
        if (prev && px >= prev.x && px <= prev.x + prev.w &&
            py >= prev.y && py <= prev.y + prev.h &&
            this.currentStepIndex > 0) {
          return 'prev';
        }
        
        // Check next button
        const next = this.buttonRegions.next;
        if (next && px >= next.x && px <= next.x + next.w &&
            py >= next.y && py <= next.y + next.h &&
            this.currentStepIndex < this.steps.length - 1) {
          return 'next';
        }
      }
      
      return null;
    } catch (error) {
      console.error('[Tutorial] Error in checkTouchInteraction:', error);
      return null;
    }
  }
}
