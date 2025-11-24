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
      detailedInstructions: 'Pinch with ONE hand near the cube. Hold for 1 second, then move your hand to reposition it.',
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
  
  // Tutorial-specific grab system (independent of FeedControls)
  private tutorialGrabActive: boolean = false;
  private tutorialGrabSide: 'left' | 'right' | null = null;
  private tutorialGrabOffset: THREE.Vector3 = new THREE.Vector3();
  private tutorialGrabStartTime: number | null = null;
  private tutorialGrabStartPosition: THREE.Vector3 | null = null;
  private tutorialGrabUpdateInterval: number | null = null;

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
  
  // ========== TUTORIAL-SPECIFIC GRAB SYSTEM ==========
  // This system works independently of FeedControls to ensure grab works in tutorial
  
  private distanceToObjectSurface(worldPoint: THREE.Vector3): number | null {
    const bounds = this.store.getObjectBounds();
    if (!bounds) return null;
    const { center, radius } = bounds;
    const distCenter = worldPoint.distanceTo(center);
    return Math.max(0, distCenter - (radius + 0.04));
  }
  
  private startTutorialGrabMonitoring() {
    // Stop any existing grab
    this.stopTutorialGrab();
    
    // Monitor for pinch near object
    const checkInterval = 50; // Check every 50ms for responsiveness
    const GRAB_MAX_DISTANCE = 0.25; // 25cm max distance
    const HOLD_TIME_MS = 150; // 150ms hold to activate grab
    
    let holdStartTime: number | null = null;
    let holdHand: 'left' | 'right' | null = null;
    
    const monitorInterval = window.setInterval(() => {
      // Check if we should stop monitoring
      if (!this.group.visible || this.isLoading || this.currentStepIndex < 0) {
        clearInterval(monitorInterval);
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
          
          if (dist !== null && dist <= GRAB_MAX_DISTANCE) {
            // Within range - start/continue hold timer
            if (holdHand === side) {
              // Same hand still pinching - check if hold time met
              if (holdStartTime !== null && Date.now() - holdStartTime >= HOLD_TIME_MS) {
                // Activate grab!
                this.activateTutorialGrab(side, pinchPos);
                clearInterval(monitorInterval);
              }
            } else {
              // New hand or different hand - reset timer
              holdStartTime = Date.now();
              holdHand = side;
            }
          } else {
            // Too far - reset
            holdStartTime = null;
            holdHand = null;
          }
        }
      } else {
        // No pinch - reset
        holdStartTime = null;
        holdHand = null;
      }
    }, checkInterval);
    
    // Store interval ID for cleanup
    (this as any).tutorialGrabMonitorInterval = monitorInterval;
  }
  
  private activateTutorialGrab(side: 'left' | 'right', pinchPos: THREE.Vector3) {
    const objPos = this.store.getObjectWorldPos();
    if (!objPos) {
      console.warn(`[Tutorial Grab] Cannot activate - object not found`);
      return;
    }
    
    this.tutorialGrabActive = true;
    this.tutorialGrabSide = side;
    this.tutorialGrabOffset.copy(objPos).sub(pinchPos);
    this.tutorialGrabStartTime = Date.now();
    this.tutorialGrabStartPosition = objPos.clone();
    
    console.log(`[Tutorial Grab] ✅ Activated! Side: ${side}, Object pos: ${objPos.toArray().map(v => v.toFixed(2)).join(',')}`);
    
    // Start update loop
    this.tutorialGrabUpdateInterval = window.setInterval(() => {
      this.updateTutorialGrab();
    }, 16); // ~60fps
  }
  
  private updateTutorialGrab() {
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
      console.log(`[Tutorial Grab] Released`);
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
    
    // Update object position directly
    this.store.setPosition(newObjPos);
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
    
    if ((this as any).tutorialGrabMonitorInterval) {
      clearInterval((this as any).tutorialGrabMonitorInterval);
      (this as any).tutorialGrabMonitorInterval = null;
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
      if (item.type === 'shape') {
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
    
    if (this.twoHandCheckInterval) {
      clearInterval(this.twoHandCheckInterval);
      this.twoHandCheckInterval = null;
    }
    if (this.grabCheckInterval) {
      clearInterval(this.grabCheckInterval);
      this.grabCheckInterval = null;
    }
    // Stop tutorial grab system
    this.stopTutorialGrab();
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
    
    // For other steps, load appropriate model
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
        if (step.id === 'rotate') {
          setTimeout(() => {
            this.rotationInitialValue = this.store.rotationY;
            console.log(`[Tutorial] Rotation tracking: initial=${this.rotationInitialValue}`);
          }, 500);
        } else if (step.id === 'scale') {
          setTimeout(() => {
            this.scaleInitialValue = this.store.scale;
            console.log(`[Tutorial] Scale tracking: initial=${this.scaleInitialValue}`);
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
    // Grab detection - use TUTORIAL-SPECIFIC grab system (independent of FeedControls)
    else if (gesture === 'grab') {
      let grabStartTime: number | null = null;
      let grabStartPosition: THREE.Vector3 | null = null;
      const REQUIRED_HOLD_MS = 1500; // 1.5 seconds
      const MIN_MOVEMENT = 0.05; // 5cm movement required
      const GRAB_MAX_DISTANCE = 0.25; // 25cm max distance to grab
      
      // Start tutorial grab monitoring
      this.startTutorialGrabMonitoring();
      
      this.grabCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.grabCheckInterval) {
            clearInterval(this.grabCheckInterval);
            this.grabCheckInterval = null;
          }
          this.stopTutorialGrab();
          return;
        }
        
        // Check if tutorial grab is active
        const isGrabbing = this.tutorialGrabActive;
        
        // Track when grab starts
        if (isGrabbing && grabStartTime === null) {
          // Grab just started
          grabStartTime = Date.now();
          const objPos = this.store.getObjectWorldPos();
          if (objPos) {
            grabStartPosition = objPos.clone();
            console.log(`[Tutorial] ✅ Grab started at position:`, objPos);
          }
        }
        
        // If currently grabbing, check if conditions are met
        if (isGrabbing && grabStartTime && grabStartPosition) {
          const holdTime = Date.now() - grabStartTime;
          const objPos = this.store.getObjectWorldPos();
          
          if (objPos) {
            const movement = objPos.distanceTo(grabStartPosition);
            
            // Check if user has held for 1.5s+ AND object has moved
            if (holdTime >= REQUIRED_HOLD_MS && movement >= MIN_MOVEMENT && !handlerFired) {
              console.log(`[Tutorial] ✅ Grab and drag completed! Hold time: ${holdTime}ms, Movement: ${(movement * 100).toFixed(1)}cm`);
              this.stopTutorialGrab();
              handler();
            }
          }
        }
        
        // Reset if grab ends
        if (!isGrabbing && grabStartTime !== null) {
          grabStartTime = null;
          grabStartPosition = null;
        }
      }, 100);
    }
    // Scroll detection
    else if (gesture === 'scroll') {
      let lastIndex = this.store.index;
      this.grabCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.grabCheckInterval) {
            clearInterval(this.grabCheckInterval);
            this.grabCheckInterval = null;
          }
          return;
        }
        
        if (this.store.index !== lastIndex && !handlerFired) {
          console.log(`[Tutorial] ✅ Scroll detected!`);
          handler();
        }
        lastIndex = this.store.index;
      }, 200);
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
    this.clearGestureHandlers();
    
    const step = this.steps[this.currentStepIndex];
    if (step) {
      step.completed = true;
    }
    
    this.updatePanel();
    
    setTimeout(() => {
      this.group.visible = false;
      
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
    this.currentStepIndex = 0;
    this.progressPercentage = 0;
    this.steps.forEach(step => step.completed = false);
    
    if ((this.group as any).panelMaterial) {
      (this.group as any).panelMaterial.opacity = 1.0;
    }
    
    this.originalFeedIndex = this.store.index;
    this.findTutorialItems();
    
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
