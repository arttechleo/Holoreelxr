// src/ui/OnboardingTutorial.ts
import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { FeedStore } from '../feed/FeedStore';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  detailedInstructions: string;
  shape: 'sphere' | 'pyramid' | 'box';
  color: string;
  gesture?: string;
  completed: boolean;
}

export class OnboardingTutorial {
  private group = new THREE.Group();
  private currentStepIndex = 0;
  private originalFeedIndex: number = 0;
  private firstNonTutorialIndex: number = 0;
  
  // Simplified reactive tutorial steps
  private steps: TutorialStep[] = [
    {
      id: 'welcome',
      title: '🎉 Welcome to HoloreelXR!',
      description: 'Hand gesture-based 3D social feed',
      detailedInstructions: 'Interact with the 3D model using hand gestures. When you first interact with it, the tutorial will guide you through each gesture.',
      shape: 'box',
      color: '#667eea',
      completed: false,
    },
    {
      id: 'rotate',
      title: '🔄 Rotate 3D Objects',
      description: 'Two-hand rotation gesture',
      detailedInstructions: 'Pinch with BOTH hands on the cube. Move your hands in a circular motion to rotate it. Rotate at least 30 degrees.',
      shape: 'box',
      color: '#4ECDC4',
      gesture: 'twohandrotate',
      completed: false,
    },
    {
      id: 'scale',
      title: '📏 Scale Objects',
      description: 'Two-hand scaling gesture',
      detailedInstructions: 'Pinch with BOTH hands on the cube. Move your hands closer together to shrink, or farther apart to enlarge.',
      shape: 'box',
      color: '#95E1D3',
      gesture: 'twohandscale',
      completed: false,
    },
    {
      id: 'grab',
      title: '✋ Grab and Move',
      description: 'Single-hand grab gesture',
      detailedInstructions: 'Pinch with ONE hand to grab the cube (works from any distance!). Move your hand to reposition it, then release the pinch to place it in the new location.',
      shape: 'box',
      color: '#FF6B6B',
      gesture: 'grab',
      completed: false,
    },
    {
      id: 'scroll',
      title: '📜 Scroll Feed',
      description: 'Navigate through content',
      detailedInstructions: 'Pinch with ONE hand away from the object. Move your hand UP or DOWN to scroll through the feed.',
      shape: 'sphere',
      color: '#6BCF7F',
      gesture: 'scroll',
      completed: false,
    },
    {
      id: 'like',
      title: '👍 Like Content',
      description: 'Thumbs up gesture',
      detailedInstructions: 'Extend your thumb upward while keeping other fingers curled. Hold the gesture to like.',
      shape: 'sphere',
      color: '#F38181',
      gesture: 'thumbsup',
      completed: false,
    },
    {
      id: 'heart',
      title: '❤️ Save Content',
      description: 'Heart gesture',
      detailedInstructions: 'Bring BOTH hands together. Touch index fingers together, then thumbs together.',
      shape: 'box',
      color: '#AA96DA',
      gesture: 'heart',
      completed: false,
    },
    {
      id: 'repost',
      title: '✌️ Repost Content',
      description: 'Peace sign gesture',
      detailedInstructions: 'Extend your index and middle fingers (peace sign) while keeping ring and pinky curled.',
      shape: 'pyramid',
      color: '#FFD93D',
      gesture: 'peace',
      completed: false,
    },
  ];

  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private panel?: THREE.Mesh;
  private hands: HandEngine;
  private store: FeedStore;
  private onComplete?: () => void;
  private tutorialItemIndices: number[] = [];
  private isLoading = false;
  private interactionMonitorInterval: number | null = null;
  private twoHandCheckInterval: number | null = null;
  private grabCheckInterval: number | null = null;
  private feedControls: any = null;
  private currentGestureHandlers: Array<{ event: string; handler: () => void }> = [];
  private progressPercentage: number = 0;
  private buttonRegions: { prev: { x: number; y: number; w: number; h: number }; next: { x: number; y: number; w: number; h: number } } | null = null;
  private hoveredButton: 'prev' | 'next' | null = null;
  private rotationInitialValue: number | null = null;
  private scaleInitialValue: number | null = null;
  private userHasInteracted = false; // Track if user has interacted with model
  private modelLoaded = false;
  
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
  
  // Scroll constants - MORE RESPONSIVE for tutorial
  private readonly SCROLL_MIN_HOLD_MS = 50; // REDUCED from 80ms for faster response
  private readonly SCROLL_DISP = 0.015; // REDUCED from 0.022 (1.5cm instead of 2.2cm)
  private readonly SCROLL_COOLDOWN_MS = 200; // REDUCED from 250ms
  private readonly SCROLL_VEL_MIN = 0.003; // REDUCED from 0.006 for more sensitive
  private readonly SCROLL_IN_AIR_DIST = 0.15; // REDUCED from 0.25m - allow closer scrolling
  private readonly SCROLL_START_FAR = 0.10; // REDUCED from 0.15m - easier to arm
  private readonly LPF_SCROLL_ALPHA = 0.35; // INCREASED from 0.28 for smoother tracking
  
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

  constructor(scene: THREE.Scene, hands: HandEngine, store: FeedStore, feedControls?: any) {
    this.hands = hands;
    this.store = store;
    this.feedControls = feedControls;
    
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 600;
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    const geo = new THREE.PlaneGeometry(0.7, 0.4);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
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
  }
  
  setFeedControls(controls: any) {
    this.feedControls = controls;
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
   */
  isGrabStepActive(): boolean {
    if (this.grabStepIndex < 0) return false;
    return this.grabStepIndex === this.currentStepIndex && this.group.visible;
  }
  
  /**
   * Check if we're currently on the scroll step
   * This allows FeedControls to disable its scroll system
   */
  isScrollStepActive(): boolean {
    if (this.scrollStepIndex < 0) return false;
    return this.scrollStepIndex === this.currentStepIndex && this.group.visible;
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
      
      if (isScrollStep && dist != null && dist >= this.SCROLL_START_FAR) {
        // On scroll step and far from object - prioritize scroll, don't grab
        this.pinchStartAt = now;
        const y = pinch.y;
        if (y != null) {
          this.lastPinchY = y;
          this.filtPinchY = y;
          this.scrollAccum = 0;
        }
        this.scrollDisarmedThisPinch = false;
        this.scrollArmed = true; // Auto-arm if far enough
        console.log(`[Tutorial Scroll] Scroll armed immediately! Distance: ${dist.toFixed(3)}m`);
      } else {
        // Enable grab - works throughout entire tutorial!
        console.log(`[Tutorial Grab] ✅ Grab enabled! ${side} hand (step: ${this.currentStepIndex})`);
        this.isGrabbing = true;
        this.grabHand = side;
        this.grabOffset.copy(objPos).sub(pinch);
        this.grabStartTime = now;
        this.grabStartPosition = objPos.clone();
        this.grabHasMoved = false;
        
        // If on scroll step and close to object, disable scroll for this pinch
        if (isScrollStep && dist != null && dist < this.SCROLL_START_FAR) {
          this.scrollDisarmedThisPinch = true;
          console.log(`[Tutorial] Close to object - grab enabled, scroll disabled`);
        }
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
    
    // Don't scroll if actively grabbing (but allow if grab just started and we're moving)
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
  
  setButtonHover(button: 'prev' | 'next' | null) {
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      this.updatePanel();
    }
  }
  
  handleButtonClick(buttonType: 'prev' | 'next'): boolean {
    if (!this.group.visible || this.isLoading) return false;
    
    if (buttonType === 'next') {
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
    this.firstNonTutorialIndex = 0;
    
    for (let i = 0; i < this.store.items.length; i++) {
      const item = this.store.items[i];
      // Only tutorial items have id starting with "tutorial-"
      // Regular shape items (blue sphere, yellow pyramid, red square) are NOT tutorial items
      if (item.type === 'shape' && item.id.startsWith('tutorial-')) {
        this.tutorialItemIndices.push(i);
      } else if (this.firstNonTutorialIndex === 0) {
        this.firstNonTutorialIndex = i;
      }
    }
  }

  private clearGestureHandlers() {
    this.currentGestureHandlers.forEach(({ event, handler }) => {
      this.hands.off(event, handler);
    });
    this.currentGestureHandlers = [];
    
    // Clear tutorial grab event handlers
    this.clearTutorialGrabHandlers();
    
    if (this.twoHandCheckInterval) {
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
    
    this.rotationInitialValue = null;
    this.scaleInitialValue = null;
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
    
    this.currentStepIndex = index;
    const step = this.steps[index];
    
    this.progressPercentage = 0;
    this.clearGestureHandlers();
    
    console.log(`[Tutorial] Showing step ${index + 1}/${this.steps.length}: ${step.title}`);
    
    this.updatePanel();
    
    // Welcome step - just show panel, load first model
    if (step.id === 'welcome') {
      this.group.visible = true;
      this.userHasInteracted = false;
      
      // Load first tutorial model
      if (this.tutorialItemIndices.length > 0) {
        this.isLoading = true;
        try {
          this.store.index = this.tutorialItemIndices[0];
          await this.store.showCurrent();
          this.modelLoaded = true;
          this.isLoading = false;
          
          // Start monitoring for interactions
          this.startInteractionMonitoring();
        } catch (error) {
          console.error(`[Tutorial] Error loading model:`, error);
          this.isLoading = false;
        }
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
            this.rotationInitTimeout = window.setTimeout(() => {
              if (this.currentStepIndex === index) { // Only set if still on same step
                this.rotationInitialValue = this.store.rotationY;
                console.log(`[Tutorial] Rotation tracking: initial=${this.rotationInitialValue}`);
              }
              this.rotationInitTimeout = null;
            }, 500);
          } else if (step.id === 'scale') {
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
    if (this.isLoading) {
      setTimeout(() => this.waitForGesture(gesture), 200);
      return;
    }
    
    this.clearGestureHandlers();
    
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
      
      // Automatically advance to next step after completion
      setTimeout(() => {
        if (this.currentStepIndex === stepIndex) {
          this.nextStep();
        }
      }, 1500);
    };
    
    // Rotation detection - monitor actual rotation changes
    if (gesture === 'twohandrotate') {
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.twoHandCheckInterval) {
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        if (this.rotationInitialValue === null) {
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
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const step = this.steps[this.currentStepIndex];
    if (!step) return;
    
    // Background
    ctx.fillStyle = step.completed ? 'rgba(20, 50, 30, 0.95)' : 'rgba(20, 20, 30, 0.95)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Title
    ctx.fillStyle = step.completed ? '#4ade80' : '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.title, this.canvas.width / 2, 50);
    
    // Description
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText(step.description, this.canvas.width / 2, 85);
    
    // Detailed instructions
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#ccc';
    const maxWidth = this.canvas.width - 80;
    const words = step.detailedInstructions.split(' ');
    let line = '';
    let y = 120;
    const lineHeight = 22;
    
    words.forEach((word) => {
      const testLine = line + (line ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line, this.canvas.width / 2, y);
        line = word;
        y += lineHeight;
      } else {
        line = testLine;
      }
    });
    if (line) {
      ctx.fillText(line, this.canvas.width / 2, y);
    }
    
    // Progress bar for rotation/scale
    if ((step.id === 'rotate' || step.id === 'scale') && !step.completed) {
      const barWidth = this.canvas.width * 0.7;
      const barHeight = 12;
      const barX = (this.canvas.width - barWidth) / 2;
      const barY = this.canvas.height - 120;
      
      ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      const progressWidth = (barWidth * this.progressPercentage) / 100;
      ctx.fillStyle = '#4ECDC4';
      ctx.fillRect(barX, barY, progressWidth, barHeight);
      
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${Math.round(this.progressPercentage)}%`, this.canvas.width / 2, barY - 10);
    }
    
    // Completion message
    if (step.completed) {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = '#4ade80';
      ctx.fillText('✅ Step Complete!', this.canvas.width / 2, y + 40);
    }
    
    // Navigation buttons
    this.drawNavigationButtons(ctx);
    
    // Instructions for button interaction (hand gestures only)
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('👆 Point with index finger, pinch to click', this.canvas.width / 2, this.canvas.height - 20);

    this.texture.needsUpdate = true;
  }
  
  private drawNavigationButtons(ctx: CanvasRenderingContext2D) {
    const buttonWidth = 140;
    const buttonHeight = 45;
    const buttonY = this.canvas.height - 80;
    const buttonSpacing = 20;
    const totalWidth = buttonWidth * 2 + buttonSpacing;
    const startX = (this.canvas.width - totalWidth) / 2;
    
    if (!this.buttonRegions) {
      this.buttonRegions = { prev: { x: 0, y: 0, w: 0, h: 0 }, next: { x: 0, y: 0, w: 0, h: 0 } };
    }
    
    // Previous button
    const prevX = startX;
    const prevEnabled = this.currentStepIndex > 0;
    const prevHovered = this.hoveredButton === 'prev';
    
    ctx.fillStyle = prevHovered ? '#5EDDD5' : (prevEnabled ? '#4ECDC4' : '#666');
    ctx.fillRect(prevX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = prevHovered ? '#fff' : (prevEnabled ? '#fff' : '#888');
    ctx.lineWidth = prevHovered ? 3 : 2;
    ctx.strokeRect(prevX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◀ Previous', prevX + buttonWidth / 2, buttonY + buttonHeight / 2 + 7);
    
    this.buttonRegions.prev = { x: prevX, y: buttonY, w: buttonWidth, h: buttonHeight };
    
    // Next button
    const nextX = startX + buttonWidth + buttonSpacing;
    const nextEnabled = this.currentStepIndex < this.steps.length - 1;
    const nextHovered = this.hoveredButton === 'next';
    
    ctx.fillStyle = nextHovered ? '#5EDDD5' : (nextEnabled ? '#4ECDC4' : '#666');
    ctx.fillRect(nextX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = nextHovered ? '#fff' : (nextEnabled ? '#fff' : '#888');
    ctx.lineWidth = nextHovered ? 3 : 2;
    ctx.strokeRect(nextX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillText('Next ▶', nextX + buttonWidth / 2, buttonY + buttonHeight / 2 + 7);
    
    this.buttonRegions.next = { x: nextX, y: buttonY, w: buttonWidth, h: buttonHeight };
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
    
    // Use window.setTimeout and store for cleanup if needed
    window.setTimeout(() => {
      // CRITICAL: Mark tutorial as completed FIRST - this disables all tutorial handlers
      this.tutorialCompleted = true;
      
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
      
      // CRITICAL: Verify FeedControls is ready
      if (this.feedControls) {
        console.log('[Tutorial] FeedControls reference exists - should be handling events');
      } else {
        console.warn('[Tutorial] WARNING: FeedControls reference is null!');
      }
      
      const targetIndex = this.firstNonTutorialIndex > 0 ? 
        Math.min(this.firstNonTutorialIndex, this.store.items.length - 1) : 
        Math.min(this.originalFeedIndex, this.store.items.length - 1);
      
      if (targetIndex >= 0 && targetIndex < this.store.items.length) {
        if (this.store.index !== targetIndex) {
          this.store.index = targetIndex;
          this.store.setTargetTransform(1, 0);
          this.store.showCurrent().catch(err => {
            console.error('[Tutorial] Error showing feed:', err);
          });
        }
      }
      
      if (this.onComplete) {
        this.onComplete();
      }
      
      // CRITICAL: Force a test to verify FeedControls is working
      setTimeout(() => {
        console.log('[Tutorial] Post-completion check:');
        console.log(`  tutorialCompleted: ${this.tutorialCompleted}`);
        console.log(`  isTutorialActive(): ${this.isTutorialActive()}`);
        console.log(`  group.visible: ${this.group.visible}`);
        console.log(`  grabEventHandlers.length: ${this.grabEventHandlers.length}`);
        console.log(`  FeedControls exists: ${!!this.feedControls}`);
      }, 100);
    }, 2000);
  }

  // Update panel position to the right of the 3D model
  updatePosition(objectPosition: THREE.Vector3, cameraPosition: THREE.Vector3) {
    if (!this.group.visible) return;
    
    // Position panel to the RIGHT of the object
    const rightOffset = new THREE.Vector3(0.5, 0, 0); // 0.5m to the right
    const panelPos = objectPosition.clone().add(rightOffset);
    panelPos.y = objectPosition.y + 0.2; // Slightly above object center
    
    this.group.position.copy(panelPos);
    
    // Make panel face camera
    this.group.lookAt(cameraPosition);
  }

  async show(camera: THREE.Camera) {
    // CRITICAL: Reset completion flag when starting tutorial
    this.tutorialCompleted = false;
    
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
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(pos);
    camera.getWorldDirection(dir);
    this.group.position.copy(pos.add(dir.multiplyScalar(1.5)));
    this.group.position.y += 0.3;
    this.group.lookAt(camera.position);
    
    await this.showStep(0);
  }

  hide() {
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.group.visible;
  }
  
  // Raycast hit test for button clicks (hand gesture based)
  raycast(ray: THREE.Ray): { button?: 'prev' | 'next' } | null {
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
      const x = uv.x * this.canvas.width;
      const y = (1 - uv.y) * this.canvas.height;
      
      if (this.buttonRegions) {
        const prev = this.buttonRegions.prev;
        if (x >= prev.x && x <= prev.x + prev.w &&
            y >= prev.y && y <= prev.y + prev.h &&
            this.currentStepIndex > 0) {
          return { button: 'prev' };
        }
        
        const next = this.buttonRegions.next;
        if (x >= next.x && x <= next.x + next.w &&
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
}
