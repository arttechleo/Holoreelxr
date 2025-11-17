// src/controls/FeedControls.ts
import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { ThreeXRApp } from '../app/ThreeXRApp';
import { FeedStore } from '../feed/FeedStore';
import ReactionHudManager from '../ui/ReactionHudManager';
import { VirtualKeyboard } from '../ui/VirtualKeyboard';
import { AdvancedKeyboard } from '../ui/AdvancedKeyboard';
import { TikTokFeedUI } from '../ui/TikTokFeedUI';
import { GestureTutorial } from '../ui/GestureTutorial';
import { BackgroundBlur } from '../effects/BackgroundBlur';
import { ParticleSystem } from '../effects/ParticleSystem';
import { CONTROLS, TRANSFORM, REACTIONS, HUD } from '../config/constants';

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
  private readonly SCALE_MIN = TRANSFORM.SCALE_MIN;
  private readonly SCALE_MAX = TRANSFORM.SCALE_MAX;
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

  // 🎹 Virtual keyboard for in-VR typing
  private virtualKeyboard: VirtualKeyboard;
  private advancedKeyboard: AdvancedKeyboard; // NEW: Advanced keyboard with autocomplete
  private keyboardActive = false;
  private useAdvancedKeyboard = true; // Toggle for advanced features
  private backgroundBlur: BackgroundBlur;
  private hoveredKey: string | null = null;
  
  // Keyboard interaction state
  private lastKeyPressTime = 0;
  private lastPressedKey: string | null = null;
  private keyPressDebounceMs = 150; // Prevent rapid re-presses (150ms feels natural)
  private isPinchingForKeyboard = false;
  private leftPinchingKeyboard = false;
  private rightPinchingKeyboard = false;
  
  // Keyboard grab/reposition state
  private keyboardGrabbed = false;
  private keyboardGrabStartTime = 0;
  private keyboardGrabSide: 'left' | 'right' | null = null;
  private keyboardGrabOffset = new THREE.Vector3();
  private keyboardAutoFollow = false; // DISABLED - keyboard stays fixed, no head tracking
  private readonly KEYBOARD_GRAB_HOLD_MS = 500; // 500ms long press to grab
  
  // Gesture state tracking to prevent loops
  private gestureTriggered = new Map<string, boolean>();
  private gestureCooldown = new Map<string, number>();
  private readonly GESTURE_COOLDOWN_MS = 2000; // 2 second cooldown between same gesture
  
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

  constructor(private app: ThreeXRApp, private hands: HandEngine, private store: FeedStore) {
    this.app.scene.add(this.rayGroup);
    this.initRay('left');
    this.initRay('right');
    this.setRayVisible('left', false);
    this.setRayVisible('right', false);

    // 🎹 Virtual keyboards for typing comments in VR
    this.virtualKeyboard = new VirtualKeyboard();
    this.app.scene.add(this.virtualKeyboard.getGroup());
    
    this.advancedKeyboard = new AdvancedKeyboard();
    this.app.scene.add(this.advancedKeyboard.getGroup());

    // 🌫️ Background blur effect
    this.backgroundBlur = new BackgroundBlur(this.app.scene, this.app.renderer, this.app.contentRoot);
    
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

    // Place HUD close to object (left icons, right comments)
    (this.hudMgr as any).setOffsets?.(
      new THREE.Vector3(-0.25, -0.05, 0.0), // icons
      new THREE.Vector3(0.28, 0.02, 0.0)    // comments panel
    );

    this.hudMgr.showFor(this.currentModelKey());

    // pinch lifecycle
    this.hands.on('leftpinchstart', () => this.onPinchStart('left'));
    this.hands.on('rightpinchstart', () => this.onPinchStart('right'));
    this.hands.on('leftpinchend', () => this.onPinchEnd('left'));
    this.hands.on('rightpinchend', () => this.onPinchEnd('right'));

    // Like / Heart (BLOCKED when keyboard active)
    this.hands.on('thumbsupstart', () => {
      if (this.keyboardActive) return; // BLOCK when typing
      if (!this.canTriggerGesture('thumbsup')) return; // Prevent loops
      if (!this.acceptGesture('like')) return;
      const now = performance.now();
      if (now - this.lastLikeAt < this.REACT_COOLDOWN_MS) return;
      this.lastLikeAt = now;
      
      const thumb = this.hands.thumbTip('left') || this.hands.thumbTip('right');
      if (thumb) {
        this.particleSystem.emit('like', thumb, 8); // ✨ Particle effect!
      }
      
      this.store.likeCurrent();
      this.hudMgr.bump(this.currentModelKey(), 'like');
      this.store.notify('👍 Liked!');
      
      this.markGestureTriggered('thumbsup');
      
      // Complete tutorial step if active
      if (this.tutorial && this.tutorial.getCurrentGesture() === 'thumbs_up') {
        this.tutorial.completeCurrentLesson();
      }
    });
    this.hands.on('heartstart', () => {
      if (this.keyboardActive) return; // BLOCK when typing
      if (!this.canTriggerGesture('heart')) return; // Prevent loops
      if (!this.acceptGesture('heart')) return;
      const now = performance.now();
      if (now - this.lastHeartAt < this.REACT_COOLDOWN_MS) return;
      this.lastHeartAt = now;
      this.store.saveCurrent();
      this.hudMgr.bump(this.currentModelKey(), 'heart');
      this.markGestureTriggered('heart');
    });

    // ILY → open in-VR compose with virtual keyboard (ONLY if not already active)
    this.hands.on('ilystart', () => {
      if (!this.canTriggerGesture('ily')) return; // Prevent loops with cooldown
      if (this.keyboardActive) return; // Don't re-open if already open
      this.showVirtualKeyboard();
      this.markGestureTriggered('ily');
    });


    // Peace → repost (BLOCKED when keyboard active)
    this.hands.on('peacestart', () => {
      if (this.keyboardActive) return; // BLOCK when typing
      if (!this.canTriggerGesture('peace')) return; // Prevent loops
      if (!this.acceptGesture('repost')) return;
      const now = performance.now();
      if (now - this.lastRepostAt < this.REACT_COOLDOWN_MS) return;
      this.lastRepostAt = now;
      this.store.repostCurrent();
      this.hudMgr.bump(this.currentModelKey(), 'repost');
      this.markGestureTriggered('peace');
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

      this.hudMgr.tick(dt);
      this.store.tick(dt);
      this.backgroundBlur.tick(dt);
      this.particleSystem.tick(dt); // ✨ Update particles
      this.feedUI.tick(dt); // 🎬 Update TikTok UI

      // Get camera position once per frame for all updates
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      this.app.camera.getWorldPosition(camPos);
      this.app.camera.getWorldDirection(camDir);

      // Update keyboard position and interactions
      if (this.keyboardActive) {
        // Check for keyboard grab gesture
        this.updateKeyboardGrab(now);
        
        // Continuously check for pinch-to-type input (not just on pinch start)
        if (this.hands.state.left.pinch) {
          this.handleKeyboardInput('left');
        }
        if (this.hands.state.right.pinch) {
          this.handleKeyboardInput('right');
        }
        
        if (this.useAdvancedKeyboard && this.advancedKeyboard.isVisible()) {
          this.updateAdvancedKeyboardPosition();
          this.updateAdvancedKeyboardHoverState();
        } else if (this.virtualKeyboard.isVisible()) {
          this.updateKeyboardPosition();
          this.updateKeyboardHoverState();
        }
      }
      
      // Update TikTok UI position
      const objPos = this.store.getObjectWorldPos();
      if (objPos) {
        this.feedUI.setPosition(objPos);
        this.feedUI.lookAt(camPos);
      }
      
      // Update tutorial position
      if (this.tutorial && this.tutorial.getGroup().visible) {
        const tutorialPos = camPos.clone().add(camDir.clone().multiplyScalar(0.8));
        tutorialPos.y += 0.1;
        this.tutorial.getGroup().position.copy(tutorialPos);
        this.tutorial.lookAt(camPos);
      }
    });
  }

  // ========== KEYBOARD POSITIONING ==========
  private updateKeyboardPosition() {
    // Keyboard ONLY moves when grabbed by hand - NO head tracking
    if (this.keyboardGrabbed) {
      // When grabbed, follow hand position
      const handPos = this.hands.pinchMid(this.keyboardGrabSide!);
      if (handPos) {
        const targetPos = handPos.clone().add(this.keyboardGrabOffset);
        this.virtualKeyboard.getGroup().position.copy(targetPos);
      }
    }
    // NO auto-follow - keyboard stays fixed in position
    // NO lookAt - keyboard orientation stays fixed
  }

  private updateKeyboardHoverState() {
    // Only show hover when pinching (ready to type)
    const leftPinching = this.hands.state.left.pinch;
    const rightPinching = this.hands.state.right.pinch;
    
    let hoveredKey: string | null = null;
    
    // Check collision only for pinching hands
    if (leftPinching) {
      const leftHand = this.hands.pinchMid('left') ?? this.hands.indexTip('left');
      if (leftHand) {
        const hit = this.virtualKeyboard.checkCollision(leftHand);
        if (hit) hoveredKey = hit.key;
      }
    }
    
    if (rightPinching && !hoveredKey) {
      const rightHand = this.hands.pinchMid('right') ?? this.hands.indexTip('right');
      if (rightHand) {
        const hit = this.virtualKeyboard.checkCollision(rightHand);
        if (hit) hoveredKey = hit.key;
      }
    }
    
    // Update hover state
    if (hoveredKey !== this.hoveredKey) {
      this.virtualKeyboard.clearHover();
      if (hoveredKey) {
        this.virtualKeyboard.hoverKey(hoveredKey);
      }
      this.hoveredKey = hoveredKey;
    }
  }
  
  // Advanced keyboard positioning
  private updateAdvancedKeyboardPosition() {
    // Keyboard ONLY moves when grabbed by hand - NO head tracking
    if (this.keyboardGrabbed) {
      // When grabbed, follow hand position
      const handPos = this.hands.pinchMid(this.keyboardGrabSide!);
      if (handPos) {
        const targetPos = handPos.clone().add(this.keyboardGrabOffset);
        this.advancedKeyboard.getGroup().position.copy(targetPos);
      }
    }
    // NO auto-follow - keyboard stays fixed in position
    // NO lookAt - keyboard orientation stays fixed
  }
  
  private updateAdvancedKeyboardHoverState() {
    // Only show hover when pinching (ready to type)
    const leftPinching = this.hands.state.left.pinch;
    const rightPinching = this.hands.state.right.pinch;
    
    let hoveredKey: string | null = null;
    
    // Check collision only for pinching hands
    if (leftPinching) {
      const leftHand = this.hands.pinchMid('left') ?? this.hands.indexTip('left');
      if (leftHand) {
        const hit = this.advancedKeyboard.checkCollision(leftHand);
        if (hit) hoveredKey = hit.key;
      }
    }
    
    if (rightPinching && !hoveredKey) {
      const rightHand = this.hands.pinchMid('right') ?? this.hands.indexTip('right');
      if (rightHand) {
        const hit = this.advancedKeyboard.checkCollision(rightHand);
        if (hit) hoveredKey = hit.key;
      }
    }
    
    // Update hover state
    if (hoveredKey !== this.hoveredKey) {
      this.advancedKeyboard.clearHover();
      if (hoveredKey) {
        this.advancedKeyboard.hoverKey(hoveredKey);
      }
      this.hoveredKey = hoveredKey;
    }
  }

  // ========== VIRTUAL KEYBOARD ==========
  private showVirtualKeyboard() {
    // Position keyboard in front of camera at fixed position
    // Keyboard will NOT move with head - only moves when grabbed
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.app.camera.getWorldPosition(camPos);
    this.app.camera.getWorldDirection(camDir);
    
    // Position at comfortable typing distance (50cm) and height
    const keyboardPos = camPos.clone().add(camDir.multiplyScalar(0.5));
    keyboardPos.y -= 0.25; // Slightly lower for natural hand position
    
    // Set fixed rotation (no lookAt - stays in fixed orientation)
    // Keyboard will face forward relative to where it was created
    
    // Use advanced keyboard if enabled
    if (this.useAdvancedKeyboard) {
      this.advancedKeyboard.show(keyboardPos, {
        onSubmit: (text: string) => {
          this.hudMgr.addCommentForCurrent(text);
          this.hideVirtualKeyboard();
          this.store.notify('✅ Comment posted!');
          // Confetti effect!
          this.particleSystem.emit('confetti', keyboardPos, 20);
        },
        onCancel: () => {
          this.hideVirtualKeyboard();
          this.store.notify('Cancelled');
        },
        onTextChange: (text: string) => {
          // Real-time feedback
        },
        placeholder: 'Share your thoughts...',
        maxLength: 500,
      });
    } else {
      // Fallback to simple keyboard
      this.virtualKeyboard.show(
        keyboardPos,
        (text: string) => {
          this.hudMgr.addCommentForCurrent(text);
          this.hideVirtualKeyboard();
          this.store.notify('✅ Comment posted!');
        },
        () => {
          this.hideVirtualKeyboard();
          this.store.notify('Cancelled');
        }
      );
    }
    
    this.keyboardActive = true;
    this.backgroundBlur.enable();
    
    // Helpful notification
    this.store.notify('✍️ Pinch fingers together and aim at keys to type!');
    
    // Tutorial progress
    if (this.tutorial && this.tutorial.getCurrentGesture() === 'ily_sign') {
      this.tutorial.completeCurrentLesson();
    }
  }

  private hideVirtualKeyboard() {
    if (this.useAdvancedKeyboard) {
      this.advancedKeyboard.hide();
      this.advancedKeyboard.clearHover();
    } else {
      this.virtualKeyboard.hide();
      this.virtualKeyboard.clearHover();
    }
    
    // Reset all keyboard state
    this.keyboardActive = false;
    this.hoveredKey = null;
    this.lastKeyPressTime = 0;
    this.lastPressedKey = null;
    this.leftPinchingKeyboard = false;
    this.rightPinchingKeyboard = false;
    
    // Reset grab state
    this.keyboardGrabbed = false;
    this.keyboardGrabStartTime = 0;
    this.keyboardGrabSide = null;
    this.keyboardAutoFollow = false; // Stay disabled - no head tracking
    
    // Reset keyboard input state
    this.lastKeyPressTime = 0;
    this.lastPressedKey = null;
    
    this.backgroundBlur.disable();
  }
  
  // ========== KEYBOARD GRAB & REPOSITION ==========
  private updateKeyboardGrab(now: number) {
    const leftPinching = this.hands.state.left.pinch;
    const rightPinching = this.hands.state.right.pinch;
    
    // Determine which hand is interacting
    const activeSide: 'left' | 'right' | null = 
      leftPinching && !rightPinching ? 'left' :
      rightPinching && !leftPinching ? 'right' :
      null;
    
    if (!activeSide) {
      // No pinch or both hands pinching - release grab if active
      if (this.keyboardGrabbed) {
        this.releaseKeyboardGrab();
      }
      this.keyboardGrabStartTime = 0;
      return;
    }
    
    const handPos = this.hands.pinchMid(activeSide);
    if (!handPos) return;
    
    const activeKeyboard = this.useAdvancedKeyboard ? this.advancedKeyboard : this.virtualKeyboard;
    const keyboardPos = activeKeyboard.getGroup().position;
    const distToKeyboard = handPos.distanceTo(keyboardPos);
    
    // Check if hand is near keyboard (within 35cm)
    if (distToKeyboard > 0.35) {
      // Too far - release grab if active
      if (this.keyboardGrabbed) {
        this.releaseKeyboardGrab();
      }
      this.keyboardGrabStartTime = 0;
      return;
    }
    
    // Check if hand is colliding with a key
    const collision = activeKeyboard.checkCollision(handPos);
    if (collision) {
      // Hand is over a key - this is for typing, not grabbing
      this.keyboardGrabStartTime = 0;
      return;
    }
    
    // Hand is pinching near keyboard but not on a key
    if (this.keyboardGrabbed && this.keyboardGrabSide === activeSide) {
      // Already grabbed - continue dragging
      return;
    }
    
    // Start timing for long-press grab
    if (this.keyboardGrabStartTime === 0) {
      this.keyboardGrabStartTime = now;
      this.keyboardGrabSide = activeSide;
    } else if (now - this.keyboardGrabStartTime >= this.KEYBOARD_GRAB_HOLD_MS) {
      // Long press achieved - grab keyboard!
      this.startKeyboardGrab(activeSide, handPos, keyboardPos);
    }
  }
  
  private startKeyboardGrab(side: 'left' | 'right', handPos: THREE.Vector3, keyboardPos: THREE.Vector3) {
    this.keyboardGrabbed = true;
    this.keyboardGrabSide = side;
    this.keyboardAutoFollow = false;
    
    // Calculate offset from hand to keyboard
    this.keyboardGrabOffset.copy(keyboardPos).sub(handPos);
    
    // Visual feedback
    this.store.notify('🖐️ Keyboard grabbed - move hand to reposition, release to lock');
    
    // Slightly enlarge keyboard to show it's grabbed
    const activeKeyboard = this.useAdvancedKeyboard ? this.advancedKeyboard : this.virtualKeyboard;
    activeKeyboard.getGroup().scale.setScalar(1.05);
  }
  
  private releaseKeyboardGrab() {
    this.keyboardGrabbed = false;
    this.keyboardGrabSide = null;
    this.keyboardGrabStartTime = 0;
    this.keyboardAutoFollow = false; // Stay disabled - keyboard stays fixed
    
    // Visual feedback
    this.store.notify('✓ Keyboard released - position locked');
    
    // Reset keyboard scale
    const activeKeyboard = this.useAdvancedKeyboard ? this.advancedKeyboard : this.virtualKeyboard;
    activeKeyboard.getGroup().scale.setScalar(1.0);
  }

  private handleKeyboardInput(side: 'left' | 'right'): boolean {
    if (!this.keyboardActive) return false;
    
    // Check which keyboard is active
    const activeKeyboard = this.useAdvancedKeyboard ? this.advancedKeyboard : this.virtualKeyboard;
    if (!activeKeyboard.isVisible()) return false;
    
    // Only process if this hand is actively pinching
    const isPinching = this.hands.state[side].pinch;
    if (!isPinching) {
      // Reset pinch state when hand releases
      if (side === 'left') this.leftPinchingKeyboard = false;
      if (side === 'right') this.rightPinchingKeyboard = false;
      return false; // Don't block if not pinching
    }
    
    const from = this.hands.pinchMid(side) ?? this.hands.indexTip(side);
    if (!from) {
      return false; // Don't block if no hand position
    }
    
    // Check for collision with keyboard keys
    const collision = activeKeyboard.checkCollision(from);
    if (collision) {
      const now = performance.now();
      
      // Track which key we're currently hovering over
      const currentHoverKey = `${side}-${collision.key}`;
      
      // If hovering over a different key, reset debounce for faster typing
      if (collision.key !== this.lastPressedKey) {
        this.lastPressedKey = null;
        this.lastKeyPressTime = 0;
      }
      
      // Debounce: prevent rapid re-presses of the same key
      // Also check if we've already pressed this key in this pinch session
      const canPress = (
        collision.key !== this.lastPressedKey || 
        now - this.lastKeyPressTime > this.keyPressDebounceMs
      );
      
      if (canPress) {
        // Mark this hand as having interacted with keyboard
        if (side === 'left') this.leftPinchingKeyboard = true;
        if (side === 'right') this.rightPinchingKeyboard = true;
        
        activeKeyboard.pressKey(collision.key);
        
        // Micro-particle effect on key press
        this.particleSystem.emit('sparkle', from, 3);
        
        // Update debounce state
        this.lastKeyPressTime = now;
        this.lastPressedKey = collision.key;
      }
      
      return true; // Block other interactions when over a key
    } else {
      // When not over any key, reset last pressed key for faster re-entry
      if (this.lastPressedKey) {
        this.lastPressedKey = null;
      }
    }
    
    // If we're near the keyboard but not hitting a key, still block other interactions
    // Check if hand is within keyboard interaction area
    const keyboardPos = activeKeyboard.getGroup().position;
    const distToKeyboard = from.distanceTo(keyboardPos);
    
    // Only block if within reasonable keyboard interaction distance (40cm)
    if (distToKeyboard < 0.4) {
      return true; // Near keyboard, block other interactions
    }
    
    // Far from keyboard, allow other interactions (scrolling, grabbing, etc.)
    return false;
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
    } else if (hit.kind === 'post' || hit.kind === 'compose') {
       this.openExternalComposer('');
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
        } else if (hit.kind === 'post' || hit.kind === 'compose') {
          this.showVirtualKeyboard();
        }
      };

      sess.addEventListener('select', clickFromEvent);
    };

    ensure();
    xr.addEventListener?.('sessionstart', ensure);
  }

  // ---------- dwell assist (camera→index finger) ----------
  private updateUiRayAndDwell(now: number) {
    const tip = this.hands.indexTip('right') ?? this.hands.indexTip('left');
    if (!tip) {
      this.uiHoverKind = null;
      this.uiLastY = null;
      return;
    }
    const camPos = new THREE.Vector3();
    this.app.camera.getWorldPosition(camPos);
    const dir = tip.clone().sub(camPos).normalize();
    const ray = new THREE.Ray(camPos, dir);

    const hit = this.hudMgr.raycastHit(ray);
    const hitKind = hit?.kind ?? null;

    if (hitKind === 'comments') {
      const y = tip.y;
      if (this.uiLastY == null) this.uiLastY = y;
      const dy = y - this.uiLastY;
      this.uiLastY = y;
      if (Math.abs(dy) >= 0.01) {
        this.hudMgr.scrollComments(dy < 0 ? +1 : -1);
        this.uiHoverKind = 'comments';
        this.uiHoverBeganAt = now;
        return;
      }
    } else {
      this.uiLastY = null;
    }

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
      } else if (hitKind === 'post' || hitKind === 'compose') {
        this.showVirtualKeyboard();
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
  private updateRays() {
    // Hide rays when keyboard is active
    if (this.keyboardActive) {
      if (this.leftRay) this.leftRay.visible = false;
      if (this.rightRay) this.rightRay.visible = false;
      return;
    }
    
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

      const to = objPos ? objPos : from.clone().add(fallbackDir.multiplyScalar(0.6));
      const pos = (line.geometry as THREE.BufferGeometry).getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      (line as any).computeLineDistances?.();
      line.visible = true;
    };
    update('left', this.leftRay);
    update('right', this.rightRay);
  }

  // ---------- pinch lifecycle / feed scroll ----------
  private onPinchStart(side: 'left' | 'right') {
    // PRIORITY 1: Check if keyboard is active (highest priority)
    if (this.keyboardActive) {
      if (this.handleKeyboardInput(side)) {
        // Don't show ray when typing
        this.setRayVisible(side, false);
        return; // Key press handled, block all other interactions
      }
    }

    // PRIORITY 2: Try clicking the MR HUD
    if (this.tryClickHud(side)) return;

    // PRIORITY 3: Normal interactions (scroll, grab, etc)
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

    const pinch = this.hands.pinchMid(side);
    const d = pinch ? this.distanceToObjectSurface(pinch) : null;

    if (d != null && d <= this.INSTANT_GRAB_DIST) {
      const objPosNow = this.store.getObjectWorldPos();
      if (objPosNow && pinch) {
        this.grabbing = true;
        this.grabSide = side;
        this.grabOffset.copy(objPosNow).sub(pinch);
        this.store.notify('Grabbed');
        this.scrollDisarmedThisPinch = true;
        return;
      }
    }

    if (d != null && d >= this.SCROLL_START_FAR) this.scrollArmed = true;
    else {
      this.scrollDisarmedThisPinch = true;
      this.tryStartGrabPending(side);
    }
  }

  private onPinchEnd(side: 'left' | 'right') {
    this.setRayVisible(side, false);
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
    // Block scroll when keyboard is active
    if (this.keyboardActive) return;
    if (now < this.scrollCooldownUntil) return;
    if (this.grabPending || this.grabbing) return;

    const lp = this.hands.state.left.pinch;
    const rp = this.hands.state.right.pinch;
    
    // FIXED: Allow scrolling with either hand OR both hands
    // Only block if neither hand is pinching
    if (!lp && !rp) {
      // Reset scroll state when no pinch
      this.lastPinchY = null;
      this.filtPinchY = null;
      return;
    }
    
    // Prefer right hand, fallback to left
    const side: 'left' | 'right' = rp ? 'right' : 'left';

    if (this.scrollDisarmedThisPinch || !this.scrollArmed) return;
    if (this.pinchStartAt && now - this.pinchStartAt < this.SCROLL_MIN_HOLD_MS) return;

    const mid = this.hands.pinchMid(side);
    if (mid) {
      const distSurf = this.distanceToObjectSurface(mid);
      // RELAXED: Made distance check less strict
      if (distSurf != null && distSurf < this.SCROLL_IN_AIR_DIST * 0.5) {
        this.scrollDisarmedThisPinch = true;
        return;
      }
    }

    const y = this.hands.pinchMid(side)?.y ?? null;
    if (y == null) return;
    if (this.filtPinchY == null) this.filtPinchY = y;
    this.filtPinchY = this.filtPinchY + (y - this.filtPinchY) * this.LPF_SCROLL_ALPHA;
    if (this.lastPinchY == null) {
      this.lastPinchY = this.filtPinchY;
      return;
    }

    const dy = this.filtPinchY - this.lastPinchY;
    this.lastPinchY = this.filtPinchY;
    
    // RELAXED: Reduced minimum velocity threshold for more responsive scrolling
    if (Math.abs(dy) < this.SCROLL_VEL_MIN * 0.5) return;

    this.scrollAccum += dy;
    
    // IMPROVED: Reduced displacement needed for smoother scrolling
    if (Math.abs(this.scrollAccum) >= this.SCROLL_DISP * 0.7) {
      const dir = this.scrollAccum < 0 ? +1 : -1;
      this.store.next(dir);
      this.hudMgr.showFor(this.currentModelKey()); // keep HUD sync
      this.scrollAccum = 0;
      this.scrollCooldownUntil = now + this.SCROLL_COOLDOWN_MS * 0.6; // Faster cooldown
      
      // Visual feedback
      this.store.notify(dir > 0 ? '⬇️ Next' : '⬆️ Previous');
    }
  }

  // ---------- two-hand transform ----------
  private updateTwoHandTransform(dt: number) {
    // Block transform when keyboard is active
    if (this.keyboardActive) return;
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
    scaleRaw = THREE.MathUtils.clamp(scaleRaw, this.SCALE_MIN, this.SCALE_MAX);

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
    // Block grab when keyboard is active
    if (this.keyboardActive) return;
    if (this.grabPending || this.grabbing) return;
    const lp = this.hands.state.left.pinch,
      rp = this.hands.state.right.pinch;
    if (lp === rp) return;
    const side: 'left' | 'right' = lp ? 'left' : 'right';
    const other = lp ? 'right' : 'left';
    if (this.hands.state[other].pinch) return;
    const pinch = this.hands.pinchMid(side);
    if (!pinch) return;
    const distSurf = this.distanceToObjectSurface(pinch);
    if (distSurf != null && distSurf <= TRANSFORM.GRAB_MAX_DISTANCE) this.tryStartGrabPending(side);
  }
  private tryStartGrabPending(side: 'left' | 'right') {
    if (this.grabbing || this.grabPending) return;
    const other = side === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) return;
    const pinch = this.hands.pinchMid(side);
    if (!pinch) return;
    const distSurf = this.distanceToObjectSurface(pinch);
    if (distSurf == null || distSurf > TRANSFORM.GRAB_MAX_DISTANCE) return;
    this.grabPending = true;
    this.grabPendingSide = side;
    this.grabPendingStartY = this.hands.pinchMid(side)?.y ?? null;
    if (this.grabTimer != null) clearTimeout(this.grabTimer);
    this.grabTimer = window.setTimeout(() => {
      if (!this.grabPending || this.grabPendingSide !== side) return;
      const other = side === 'left' ? 'right' : 'left';
      const stillPinching = this.hands.state[side].pinch && !this.hands.state[other].pinch;
      const mid = this.hands.pinchMid(side);
      const objPosNow = this.store.getObjectWorldPos();
      if (!stillPinching || !mid || !objPosNow) {
        this.cancelGrabPending();
        return;
      }
      this.grabOffset.copy(objPosNow).sub(mid);
      this.grabPending = false;
      this.grabPendingSide = null;
      this.grabPendingStartY = null;
      this.grabbing = true;
      this.grabSide = side;
      this.store.notify('Grabbed – move your hand to place');
    }, this.HOLD_MS);
  }
  private cancelGrabPending() {
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
    const yNow = this.hands.pinchMid(this.grabPendingSide)?.y ?? null;
    if (yNow != null && this.grabPendingStartY != null) {
      if (Math.abs(yNow - this.grabPendingStartY) > this.PENDING_CANCEL_MOVE) {
        this.cancelGrabPending();
        return;
      }
    }
    const other = this.grabPendingSide === 'left' ? 'right' : 'left';
    if (this.hands.state[other].pinch) this.cancelGrabPending();
  }
  private updateGrabDrag() {
    if (!this.grabbing || !this.grabSide) return;
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
      this.store.notify('Placed');
      return;
    }
    const mid = this.hands.pinchMid(this.grabSide);
    if (!mid) return;
    this.store.setPosition(mid.clone().add(this.grabOffset));
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
