// src/ui/OnboardingTutorial.ts
import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';
import { FeedStore } from '../feed/FeedStore';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  shape: 'sphere' | 'pyramid' | 'box';
  color: string;
  gesture?: string; // 'twohandrotate', 'twohandscale', 'grab', 'heart', 'thumbsup', 'peace', 'scroll'
  completed: boolean;
}

export class OnboardingTutorial {
  private group = new THREE.Group();
  private currentStepIndex = 0;
  private originalFeedIndex: number = 0; // Save original feed index before tutorial
  private firstNonTutorialIndex: number = 0; // Index of first non-tutorial item
  private steps: TutorialStep[] = [
    {
      id: 'welcome',
      title: '🎉 Welcome to HoloreelXR!',
      description: 'Learn the basics of 3D interaction in Mixed Reality. Follow along and try each gesture!',
      shape: 'box',
      color: '#667eea',
      completed: false,
    },
    {
      id: 'rotate',
      title: 'Rotate 3D Object',
      description: 'Pinch with both hands and rotate to spin the object',
      shape: 'box',
      color: '#4ECDC4',
      gesture: 'twohandrotate',
      completed: false,
    },
    {
      id: 'scale',
      title: 'Scale Object',
      description: 'Pinch with both hands, move closer to shrink, farther to enlarge',
      shape: 'box',
      color: '#95E1D3',
      gesture: 'twohandscale',
      completed: false,
    },
    {
      id: 'grab',
      title: 'Hold and Place',
      description: 'Pinch near the cube and move your hand to place it',
      shape: 'box',
      color: '#FF6B6B',
      gesture: 'grab',
      completed: false,
    },
    {
      id: 'heart',
      title: 'Heart Gesture',
      description: 'Touch index fingers AND thumbs together (both hands)',
      shape: 'box',
      color: '#AA96DA',
      gesture: 'heart',
      completed: false,
    },
    {
      id: 'like',
      title: 'Thumbs Up to Like',
      description: 'Extend thumb, curl other fingers',
      shape: 'sphere',
      color: '#F38181',
      gesture: 'thumbsup',
      completed: false,
    },
    {
      id: 'repost',
      title: 'Peace Sign to Repost',
      description: 'Extend index and middle fingers, curl others',
      shape: 'pyramid',
      color: '#FFD93D',
      gesture: 'peace',
      completed: false,
    },
    {
      id: 'scroll',
      title: 'Scroll Through Feed',
      description: 'Pinch and move hand up/down away from object',
      shape: 'sphere',
      color: '#6BCF7F',
      gesture: 'scroll',
      completed: false,
    },
  ];

  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private panel?: THREE.Mesh;
  private hands: HandEngine;
  private store: FeedStore;
  private onComplete?: () => void;
  private tutorialItemIndices: number[] = []; // Indices of tutorial items in feed
  private isLoading = false; // Prevent gesture handlers during loading
  private twoHandCheckInterval: number | null = null; // For detecting two-hand gestures
  private grabCheckInterval: number | null = null; // For detecting grab
  private feedControls: any = null; // Reference to FeedControls for checking state
  private currentGestureHandlers: Array<{ event: string; handler: () => void }> = []; // Track active handlers
  private progressPercentage: number = 0; // Current progress for progress steps (0-100)
  private skipTimeout: number | null = null; // Timeout for skip option
  private panelOpacity: number = 1.0; // For fade transitions
  private fadeInterval: number | null = null; // Current fade animation interval
  private currentTimeoutId: number | null = null; // Current step timeout ID
  private buttonRegions: { prev: { x: number; y: number; w: number; h: number }; next: { x: number; y: number; w: number; h: number } } | null = null; // Button click regions
  private hoveredButton: 'prev' | 'next' | null = null; // Currently hovered button (for visual feedback)

  constructor(scene: THREE.Scene, hands: HandEngine, store: FeedStore, feedControls?: any) {
    this.hands = hands;
    this.store = store;
    this.feedControls = feedControls;
    
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    const ctx = this.canvas.getContext('2d')!;
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    const geo = new THREE.PlaneGeometry(0.6, 0.3);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      opacity: 1.0,
    });
    
    // Store material reference for opacity control
    (this.group as any).panelMaterial = mat;
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.position.set(0, 0.4, 0);
    this.group.add(this.panel);
    
    // Make panel clickable for button interactions
    this.panel.userData = { tutorial: this };
    
    scene.add(this.group);
    // Tutorial items will be found when show() is called (after feed loads)
  }
  
  // Set hover state for visual feedback (hand gesture pointing)
  setButtonHover(button: 'prev' | 'next' | null) {
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      this.updatePanel(); // Update to show hover state
    }
  }
  
  // Public method to handle button clicks (called from FeedControls - triggered by pinch gesture)
  handleButtonClick(buttonType: 'prev' | 'next'): boolean {
    if (!this.group.visible || this.isLoading) return false;
    
    console.log(`[Tutorial] Button clicked via hand gesture (pinch): ${buttonType}`);
    
    if (buttonType === 'next') {
      if (this.currentStepIndex < this.steps.length - 1) {
        console.log(`[Tutorial] Next button clicked, advancing from step ${this.currentStepIndex}`);
        this.hoveredButton = null; // Clear hover after click
        this.nextStep();
        return true;
      }
    } else if (buttonType === 'prev') {
      if (this.currentStepIndex > 0) {
        console.log(`[Tutorial] Previous button clicked, going back to step ${this.currentStepIndex - 1}`);
        this.hoveredButton = null; // Clear hover after click
        this.previousStep();
        return true;
      }
    }
    return false;
  }
  
  private previousStep() {
    if (this.currentStepIndex > 0) {
      console.log(`[Tutorial] Moving from step ${this.currentStepIndex} to step ${this.currentStepIndex - 1}`);
      this.showStep(this.currentStepIndex - 1);
    }
  }
  
  private findTutorialItems() {
    // Reset indices
    this.tutorialItemIndices = [];
    this.firstNonTutorialIndex = 0;
    
    // Safety check: ensure store has items
    if (!this.store || !this.store.items || this.store.items.length === 0) {
      console.warn('[Tutorial] Store has no items');
      return false;
    }
    
    // Find shape items for tutorial steps (skip welcome step which doesn't need an item)
    for (let i = 0; i < this.store.items.length && this.tutorialItemIndices.length < 7; i++) {
      const item = this.store.items[i];
      if (item && item.type === 'shape') {
        this.tutorialItemIndices.push(i);
      }
    }
    
    // Find first non-tutorial item (first item that's not a shape type tutorial)
    for (let i = 0; i < this.store.items.length; i++) {
      const item = this.store.items[i];
      if (item && item.type !== 'shape') {
        this.firstNonTutorialIndex = i;
        break;
      }
    }
    
    // If all items are shapes, use first item after tutorial items
    if (this.firstNonTutorialIndex === 0 && this.tutorialItemIndices.length > 0) {
      this.firstNonTutorialIndex = Math.min(this.tutorialItemIndices.length, this.store.items.length);
    }
    
    // Need at least as many tutorial items as steps (minus welcome step)
    const requiredItems = this.steps.length - 1; // -1 for welcome step
    return this.tutorialItemIndices.length >= requiredItems;
  }

  setOnComplete(callback: () => void) {
    this.onComplete = callback;
  }

  setFeedControls(controls: any) {
    this.feedControls = controls;
  }

  async showStep(index: number) {
    // Validate index
    if (index < 0 || index >= this.steps.length) {
      if (index >= this.steps.length) {
        this.complete();
      }
      return;
    }

    // Reset progress for new step
    this.progressPercentage = 0;
    (this as any).stepStartTime = Date.now();
    
    // Clear any pending operations before starting new step
    this.clearGestureHandlers();
    
    // Fade transition (skip on first step)
    try {
      if (index > 0) {
        await this.fadeOut();
      }
    } catch (error) {
      console.error('[Tutorial] Error during fade out:', error);
      // Continue anyway
    }
    
    this.currentStepIndex = index;
    const step = this.steps[index];
    
    if (!step) {
      console.error(`[Tutorial] Step ${index} not found`);
      this.complete();
      return;
    }
    
    // Set loading state to prevent gesture handlers from firing during transition
    this.isLoading = true;
    
    // Clear skip timeout
    if (this.skipTimeout) {
      clearTimeout(this.skipTimeout);
      this.skipTimeout = null;
    }
    
    // Skip welcome step (index 0) - it doesn't need a model
    // Map tutorial steps (index 1+) to tutorial items (index 0+)
    const tutorialItemIndex = index - 1; // Subtract 1 to account for welcome step
    
    if (step.id === 'welcome') {
      // Welcome step - no model needed
      this.isLoading = false;
    } else if (tutorialItemIndex >= 0 && tutorialItemIndex < this.tutorialItemIndices.length) {
      const feedIndex = this.tutorialItemIndices[tutorialItemIndex];
      
      // Only change index if it's different to avoid unnecessary reloads
      if (this.store.index !== feedIndex) {
        this.store.index = feedIndex;
        try {
          // Load model asynchronously without blocking
          await this.store.showCurrent();
        } catch (error) {
          console.error('Failed to load tutorial item:', error);
          // Continue anyway - don't block tutorial
        }
      }
      
      // Ensure the shape has proper material (not wireframe)
      // Wait a frame for the shape to be added to the scene
      requestAnimationFrame(() => {
        // Safety check: ensure we're still on the same step
        if (this.currentStepIndex !== index) {
          console.log(`[Tutorial] Step changed during loading (was ${index}, now ${this.currentStepIndex}), skipping setup`);
          this.isLoading = false;
          return;
        }
        
        try {
          const obj = this.store.getObject();
          if (obj && obj.type === 'Mesh') {
            const mesh = obj as THREE.Mesh;
            if (mesh.material) {
              const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.wireframe = false;
                mat.needsUpdate = true;
              }
            }
          }
        } catch (error) {
          console.error('[Tutorial] Error setting up shape material:', error);
        }
        
        // Clear loading state after shape is ready
        this.isLoading = false;
        console.log(`[Tutorial] Loading complete for step ${index}, isLoading=${this.isLoading}`);
        
        // Set up gesture handlers now that loading is complete
        if (this.currentStepIndex === index && step.gesture) {
          console.log(`[Tutorial] Setting up gesture handler for step ${index}: ${step.gesture}`);
          this.waitForGesture(step.gesture);
        } else {
          console.log(`[Tutorial] Skipping gesture setup: currentStepIndex=${this.currentStepIndex}, index=${index}, gesture=${step.gesture}`);
        }
      });
    } else if (step.id !== 'welcome') {
      // No model to load for this step (shouldn't happen for non-welcome steps)
      console.warn(`[Tutorial] No model found for step ${index}: ${step.id}`);
      this.isLoading = false;
      // Auto-advance if we can't load the step
      setTimeout(() => {
        if (this.currentStepIndex === index) {
          console.log(`[Tutorial] Auto-advancing from step ${index} due to missing model`);
          this.nextStep();
        }
      }, 1000);
    }

    // Update panel
    this.updatePanel();
    
    // Fade in
    try {
      await this.fadeIn();
    } catch (error) {
      console.error('[Tutorial] Error during fade in:', error);
      // Continue anyway - set opacity manually
      this.panelOpacity = 1.0;
      if ((this.group as any).panelMaterial) {
        (this.group as any).panelMaterial.opacity = 1.0;
      }
    }

    // Listen for gesture completion
    if (step.gesture) {
      // Set up skip gesture (pinch both hands together for 2 seconds)
      this.setupSkipGesture(index);
      
      // If no model to load (shouldn't happen for gesture steps), set up handlers immediately
      if (step.id === 'welcome') {
        // This shouldn't happen, but handle it gracefully
        this.waitForGesture(step.gesture);
      }
      // Otherwise, handlers will be set up in requestAnimationFrame above
    } else {
      // Auto-advance after 3 seconds for welcome/completion steps (no gesture required)
      setTimeout(() => {
        if (this.currentStepIndex === index) {
          this.nextStep();
        }
      }, 3000);
    }
  }
  
  private async fadeOut(): Promise<void> {
    return new Promise((resolve) => {
      // Clear any existing fade animation
      if (this.fadeInterval) {
        clearInterval(this.fadeInterval);
        this.fadeInterval = null;
      }
      
      if (this.panelOpacity <= 0 || !this.group.visible) {
        this.panelOpacity = 0;
        resolve();
        return;
      }
      
      const fadeSpeed = 0.15;
      this.fadeInterval = window.setInterval(() => {
        this.panelOpacity = Math.max(0, this.panelOpacity - fadeSpeed);
        if ((this.group as any).panelMaterial) {
          (this.group as any).panelMaterial.opacity = this.panelOpacity;
        }
        
        if (this.panelOpacity <= 0) {
          if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
          }
          resolve();
        }
      }, 16); // ~60fps
    });
  }
  
  private async fadeIn(): Promise<void> {
    return new Promise((resolve) => {
      // Clear any existing fade animation
      if (this.fadeInterval) {
        clearInterval(this.fadeInterval);
        this.fadeInterval = null;
      }
      
      if (this.panelOpacity >= 1) {
        this.panelOpacity = 1.0;
        if ((this.group as any).panelMaterial) {
          (this.group as any).panelMaterial.opacity = 1.0;
        }
        resolve();
        return;
      }
      
      const fadeSpeed = 0.15;
      this.fadeInterval = window.setInterval(() => {
        this.panelOpacity = Math.min(1, this.panelOpacity + fadeSpeed);
        if ((this.group as any).panelMaterial) {
          (this.group as any).panelMaterial.opacity = this.panelOpacity;
        }
        
        if (this.panelOpacity >= 1) {
          if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
          }
          resolve();
        }
      }, 16); // ~60fps
    });
  }
  
  private setupSkipGesture(stepIndex: number) {
    let skipHoldStart: number | null = null;
    const SKIP_HOLD_MS = 2000; // Hold both hands pinched for 2 seconds to skip
    
    const skipCheckInterval = window.setInterval(() => {
      if (this.currentStepIndex !== stepIndex || this.isLoading) {
        clearInterval(skipCheckInterval);
        return;
      }
      
      const lp = this.hands.state.left.pinch;
      const rp = this.hands.state.right.pinch;
      
      if (lp && rp) {
        if (skipHoldStart === null) {
          skipHoldStart = Date.now();
          console.log('[Tutorial] Skip gesture detected, hold for 2 seconds...');
        } else {
          const holdTime = Date.now() - skipHoldStart;
          if (holdTime >= SKIP_HOLD_MS) {
            clearInterval(skipCheckInterval);
            console.log(`[Tutorial] Skip gesture completed, skipping step ${stepIndex}`);
            if (this.steps[stepIndex]) {
              this.steps[stepIndex].completed = true;
            }
            this.clearGestureHandlers();
            this.updatePanel();
            setTimeout(() => this.nextStep(), 500);
          }
        }
      } else {
        skipHoldStart = null;
      }
    }, 100);
    
    // Store interval so we can clear it
    (this as any).skipCheckInterval = skipCheckInterval;
  }

  private waitForGesture(gesture: string) {
    // Don't set up handlers if we're loading - retry after a short delay
    if (this.isLoading) {
      setTimeout(() => this.waitForGesture(gesture), 200);
      return;
    }
    
    // Clean up any existing gesture handlers first
    this.clearGestureHandlers();
    
    const stepIndex = this.currentStepIndex; // Capture current step
    const expectedGesture = this.steps[stepIndex]?.gesture;
    
    if (!expectedGesture) {
      console.warn('No gesture expected for step', stepIndex);
      return;
    }
    
    let handlerFired = false; // Prevent multiple fires
    
    // Add timeout to prevent freezing - show hint after 10s, auto-skip after 20s
    const hintTimeoutId = setTimeout(() => {
      if (!handlerFired && this.currentStepIndex === stepIndex && !this.isLoading) {
        // Show helpful hint on panel
        this.updatePanel();
        console.log(`[Tutorial] Step ${stepIndex} taking a while, showing hint...`);
      }
    }, 10000); // Show hint after 10 seconds
    (this as any).hintTimeoutId = hintTimeoutId; // Store for cleanup
    
    const timeoutId = setTimeout(() => {
      if (!handlerFired && this.currentStepIndex === stepIndex && !this.isLoading) {
        console.warn(`Tutorial step ${stepIndex} timed out after 20s, auto-advancing...`);
        handlerFired = true;
        clearTimeout(hintTimeoutId);
        if (this.steps[stepIndex]) {
          this.steps[stepIndex].completed = true;
        }
        this.clearGestureHandlers();
        this.nextStep();
      }
    }, 20000); // 20 second timeout with hint at 10s
    (this as any).currentTimeoutId = timeoutId; // Store for cleanup
    
    const handler = () => {
      // Final validation before proceeding
      if (this.isLoading) {
        console.log(`[Tutorial] Handler blocked: isLoading=${this.isLoading} - will retry`);
        // Retry after a short delay if still loading
        setTimeout(() => {
          if (!this.isLoading && this.currentStepIndex === stepIndex) {
            handler();
          }
        }, 100);
        return;
      }
      
      // Only proceed if we're still on the same step and gesture matches
      // Note: step might already be marked as completed by rotation detection
      if (this.currentStepIndex === stepIndex && 
          this.steps[stepIndex]?.gesture === expectedGesture) {
        console.log(`[Tutorial] Handler executing for step ${stepIndex}, gesture: ${expectedGesture}`);
        
        // Set handlerFired to prevent multiple calls
        handlerFired = true;
        if ((this as any).currentTimeoutId) {
          clearTimeout((this as any).currentTimeoutId);
          (this as any).currentTimeoutId = null;
        }
        if ((this as any).hintTimeoutId) {
          clearTimeout((this as any).hintTimeoutId);
          (this as any).hintTimeoutId = null;
        }
        
        // Mark step as completed (might already be done, but ensure it)
        if (this.steps[stepIndex]) {
          this.steps[stepIndex].completed = true;
          console.log(`[Tutorial] Step ${stepIndex} marked as completed`);
        }
        
        // Clear handlers immediately to prevent interference
        this.clearGestureHandlers();
        
        // Show success feedback
        console.log(`✅ Tutorial step ${stepIndex + 1}/${this.steps.length} completed!`);
        this.updatePanel(); // Update panel to show completion
        
        // Advance to next step after brief delay for visual feedback
        const advanceTimeout = setTimeout(() => {
          // Double-check we're still on the same step before advancing
          if (this.currentStepIndex === stepIndex && this.steps[stepIndex]?.completed) {
            console.log(`[Tutorial] Advancing to next step from step ${stepIndex}`);
            try {
              this.nextStep();
            } catch (error) {
              console.error(`[Tutorial] Error in nextStep():`, error);
              // Force advance if nextStep fails
              if (this.currentStepIndex === stepIndex) {
                this.currentStepIndex = stepIndex + 1;
                if (this.currentStepIndex < this.steps.length) {
                  this.showStep(this.currentStepIndex).catch(err => {
                    console.error(`[Tutorial] Error showing next step:`, err);
                  });
                } else {
                  this.complete();
                }
              }
            }
          } else {
            console.log(`[Tutorial] Step changed during delay (current: ${this.currentStepIndex}, completed: ${this.steps[stepIndex]?.completed}), skipping advance`);
          }
        }, 1000); // Reduced delay to 1 second for better responsiveness
        
        // Store timeout for cleanup if needed
        (this as any).advanceTimeout = advanceTimeout;
      } else {
        console.log(`[Tutorial] Handler skipped: currentStepIndex=${this.currentStepIndex}, stepIndex=${stepIndex}, gesture=${this.steps[stepIndex]?.gesture}, expected=${expectedGesture}, completed=${this.steps[stepIndex]?.completed}, isLoading=${this.isLoading}`);
        
        // If step is already completed but handler was called, try to advance anyway
        if (this.steps[stepIndex]?.completed && this.currentStepIndex === stepIndex) {
          console.log(`[Tutorial] Step already completed, forcing advance...`);
          this.clearGestureHandlers();
          setTimeout(() => {
            if (this.currentStepIndex === stepIndex) {
              this.nextStep();
            }
          }, 500);
        }
      }
    };
    
    // Register appropriate listeners based on gesture type
    console.log(`[Tutorial] Setting up gesture handler for step ${stepIndex}: ${gesture}`);
    
    // Clear any existing check intervals
    if (this.twoHandCheckInterval) {
      clearInterval(this.twoHandCheckInterval);
      this.twoHandCheckInterval = null;
    }
    if (this.grabCheckInterval) {
      clearInterval(this.grabCheckInterval);
      this.grabCheckInterval = null;
    }
    
    if (gesture === 'twohandrotate') {
      // Simple rotation detection: track when rotation exceeds 0.5 radians from initial
      const initialRotY = this.store.rotationY; // Track starting rotation
      const REQUIRED_ROTATION = 0.5; // 0.5 radians (~28.6 degrees)
      
      console.log(`[Tutorial] 🔄 Rotation tracking started: initial=${initialRotY.toFixed(4)} rad, target=${REQUIRED_ROTATION} rad (${(REQUIRED_ROTATION * 180 / Math.PI).toFixed(1)}°)`);
      
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.twoHandCheckInterval) {
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        const currentRotY = this.store.rotationY;
        const now = Date.now();
        
        // Calculate absolute rotation difference (handle wrap-around)
        let rotDiff = Math.abs(currentRotY - initialRotY);
        
        // Handle wrap-around: rotation can go from 2π to 0 or vice versa
        // Normalize to [0, π] range
        if (rotDiff > Math.PI) {
          rotDiff = 2 * Math.PI - rotDiff;
        }
        
        // Calculate progress percentage (0-100%)
        const progress = (rotDiff / REQUIRED_ROTATION) * 100;
        this.progressPercentage = Math.min(100, Math.max(0, progress));
        
        // Update panel to show progress (throttle updates)
        if (now % 200 < 100) { // Update every ~200ms
          this.updatePanel();
        }
        
        // Debug logging every 2 seconds
        if (now % 2000 < 100) {
          console.log(`[Tutorial] Rotation check: current=${currentRotY.toFixed(4)} rad, diff=${rotDiff.toFixed(4)} rad (${(rotDiff * 180 / Math.PI).toFixed(1)}°), progress=${this.progressPercentage.toFixed(1)}%`);
        }
        
        // Complete when rotation exceeds 0.5 radians
        if (rotDiff >= REQUIRED_ROTATION) {
          // Double-check conditions before proceeding
          if (!handlerFired && this.currentStepIndex === stepIndex && !this.isLoading && !this.steps[stepIndex]?.completed) {
            console.log(`[Tutorial] ✅ ROTATION COMPLETE! Step ${stepIndex} - rotation=${rotDiff.toFixed(4)} rad (${(rotDiff * 180 / Math.PI).toFixed(1)}°), required=${REQUIRED_ROTATION} rad (${(REQUIRED_ROTATION * 180 / Math.PI).toFixed(1)}°)`);
            console.log(`[Tutorial] State check: handlerFired=${handlerFired}, currentStepIndex=${this.currentStepIndex}, stepIndex=${stepIndex}, isLoading=${this.isLoading}, completed=${this.steps[stepIndex]?.completed}`);
            
            // Set handlerFired immediately to prevent multiple calls
            handlerFired = true;
            
            // Clear interval first to prevent further checks
            if (this.twoHandCheckInterval) {
              clearInterval(this.twoHandCheckInterval);
              this.twoHandCheckInterval = null;
            }
            
            // Ensure loading state is cleared before calling handler
            this.isLoading = false;
            
            // Mark step as completed immediately to prevent race conditions
            if (this.steps[stepIndex]) {
              this.steps[stepIndex].completed = true;
              console.log(`[Tutorial] Step ${stepIndex} marked as completed BEFORE handler call`);
            }
            
            // Call handler - it will handle the rest
            try {
              // Ensure we're in a good state before calling handler
              if (this.currentStepIndex === stepIndex && !this.isLoading) {
                handler();
                console.log(`[Tutorial] Handler called successfully`);
                
                // Double-check: if handler didn't advance after a delay, force advance
                setTimeout(() => {
                  if (this.currentStepIndex === stepIndex && this.steps[stepIndex]?.completed) {
                    console.log(`[Tutorial] Handler completed step but didn't advance, forcing advance...`);
                    this.nextStep();
                  }
                }, 1000); // Check after 1 second
              } else {
                console.warn(`[Tutorial] Cannot call handler: currentStepIndex=${this.currentStepIndex}, stepIndex=${stepIndex}, isLoading=${this.isLoading}`);
                // Force advance anyway if step is marked complete
                if (this.steps[stepIndex]?.completed) {
                  this.clearGestureHandlers();
                  this.updatePanel();
                  setTimeout(() => this.nextStep(), 500);
                }
              }
            } catch (error) {
              console.error(`[Tutorial] Error calling handler:`, error);
              // If handler fails, manually advance step
              if (this.currentStepIndex === stepIndex && this.steps[stepIndex]) {
                this.steps[stepIndex].completed = true;
                this.clearGestureHandlers();
                this.updatePanel();
                setTimeout(() => {
                  if (this.currentStepIndex === stepIndex) {
                    this.nextStep();
                  }
                }, 500);
              }
            }
            
            return;
          } else {
            // Log why handler wasn't called
            if (handlerFired) {
              console.log(`[Tutorial] Handler already fired, skipping`);
            } else if (this.currentStepIndex !== stepIndex) {
              console.log(`[Tutorial] Step changed (${this.currentStepIndex} !== ${stepIndex}), skipping handler`);
            } else if (this.isLoading) {
              console.log(`[Tutorial] Still loading, skipping handler`);
            } else if (this.steps[stepIndex]?.completed) {
              console.log(`[Tutorial] Step already completed, skipping handler`);
            }
          }
        }
      }, 100); // Check every 100ms for responsive detection
      console.log(`[Tutorial] Registered rotation detector for step ${stepIndex} - requires ${REQUIRED_ROTATION} rad (${(REQUIRED_ROTATION * 180 / Math.PI).toFixed(1)}°) rotation`);
    } else if (gesture === 'twohandscale') {
      // Check for two-hand scale by monitoring scale changes
      let lastScale = this.store.scale;
      let scaleDetected = false;
      let scaleStartTime = 0;
      let totalScaleChange = 0; // Track cumulative scale change
      
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.twoHandCheckInterval) {
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        const lp = this.hands.state.left.pinch;
        const rp = this.hands.state.right.pinch;
        const currentScale = this.store.scale;
        
        if (lp && rp) {
          // Both hands pinching - check if scale changed
          const scaleDelta = Math.abs(currentScale - lastScale);
          // Lower threshold for easier detection (0.02 = 2% change)
          if (scaleDelta > 0.02) {
            totalScaleChange += scaleDelta;
            
            if (!scaleDetected) {
              scaleDetected = true;
              scaleStartTime = Date.now();
              console.log(`[Tutorial] Scale started: delta=${scaleDelta.toFixed(4)}, total=${totalScaleChange.toFixed(4)}`);
            }
            
            // Complete if: scale detected AND (held for 500ms OR total change > 0.1 = 10%)
            const timeHeld = Date.now() - scaleStartTime;
            const hasEnoughChange = totalScaleChange > 0.1; // 10% total change
            const hasHeldTime = timeHeld > 500;
            
            // Update progress percentage (max 100%)
            this.progressPercentage = Math.min(100, (totalScaleChange / 0.1) * 100);
            
            // Update panel periodically to show progress
            if (timeHeld % 200 < 100) {
              this.updatePanel();
            }
            
            if (scaleDetected && (hasHeldTime || hasEnoughChange)) {
              if (!handlerFired && this.currentStepIndex === stepIndex) {
                console.log(`[Tutorial] ✅ Two-hand scale detected on step ${stepIndex} - delta=${scaleDelta.toFixed(4)}, total=${totalScaleChange.toFixed(4)}, time=${timeHeld}ms - marking complete!`);
                
                // Set handlerFired immediately to prevent multiple calls
                handlerFired = true;
                
                // Clear interval first to prevent further checks
                if (this.twoHandCheckInterval) {
                  clearInterval(this.twoHandCheckInterval);
                  this.twoHandCheckInterval = null;
                }
                
                // Call handler - it will handle the rest
                try {
                  handler();
                } catch (error) {
                  console.error(`[Tutorial] Error calling handler:`, error);
                  // If handler fails, manually advance step
                  if (this.currentStepIndex === stepIndex && this.steps[stepIndex]) {
                    this.steps[stepIndex].completed = true;
                    this.clearGestureHandlers();
                    setTimeout(() => this.nextStep(), 500);
                  }
                }
                
                return; // Exit interval after completion
              }
            }
          }
          lastScale = currentScale;
        } else {
          // Reset if hands not pinching
          if (scaleDetected) {
            console.log(`[Tutorial] Hands released, resetting scale detection`);
          }
          scaleDetected = false;
          totalScaleChange = 0;
          lastScale = currentScale;
        }
      }, 150); // Reduced frequency for better performance
      console.log(`[Tutorial] Registered two-hand scale detector for step ${stepIndex}`);
    } else if (gesture === 'grab') {
      // Check for grab by monitoring FeedControls grab state
      this.grabCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.grabCheckInterval) {
            clearInterval(this.grabCheckInterval);
            this.grabCheckInterval = null;
          }
          return;
        }
        
        // Check if grab is active in FeedControls
        if (this.feedControls && (this.feedControls as any).grabbing === true) {
          if (!handlerFired && this.currentStepIndex === stepIndex) {
            console.log(`[Tutorial] ✅ Grab detected on step ${stepIndex} - marking complete!`);
            
            // Set handlerFired immediately to prevent multiple calls
            handlerFired = true;
            
            // Clear interval first to prevent further checks
            if (this.grabCheckInterval) {
              clearInterval(this.grabCheckInterval);
              this.grabCheckInterval = null;
            }
            
            // Call handler - it will handle the rest
            try {
              handler();
            } catch (error) {
              console.error(`[Tutorial] Error calling handler:`, error);
              // If handler fails, manually advance step
              if (this.currentStepIndex === stepIndex && this.steps[stepIndex]) {
                this.steps[stepIndex].completed = true;
                this.clearGestureHandlers();
                setTimeout(() => this.nextStep(), 500);
              }
            }
            
            return; // Exit interval after completion
          }
        }
      }, 200);
      console.log(`[Tutorial] Registered grab detector for step ${stepIndex}`);
    } else if (gesture === 'scroll') {
      // For scroll, listen to both left and right pinch
      let lastFireTime = 0;
      const debouncedHandler = () => {
        const now = Date.now();
        if (now - lastFireTime < 500) return; // Debounce 500ms
        lastFireTime = now;
        console.log(`[Tutorial] Scroll gesture detected on step ${stepIndex}`);
        handler();
      };
      
      this.hands.on('leftpinchstart', debouncedHandler);
      this.hands.on('rightpinchstart', debouncedHandler);
      this.currentGestureHandlers.push(
        { event: 'leftpinchstart', handler: debouncedHandler },
        { event: 'rightpinchstart', handler: debouncedHandler }
      );
      console.log(`[Tutorial] Registered scroll handlers for step ${stepIndex}`);
    } else if (gesture === 'thumbsup') {
      this.hands.on('thumbsupstart', handler);
      this.currentGestureHandlers.push({ event: 'thumbsupstart', handler });
      console.log(`[Tutorial] Registered thumbsup handler for step ${stepIndex}`);
    } else if (gesture === 'heart') {
      this.hands.on('heartstart', handler);
      this.currentGestureHandlers.push({ event: 'heartstart', handler });
      console.log(`[Tutorial] Registered heart handler for step ${stepIndex}`);
    } else if (gesture === 'peace') {
      this.hands.on('peacestart', handler);
      this.currentGestureHandlers.push({ event: 'peacestart', handler });
      console.log(`[Tutorial] Registered peace handler for step ${stepIndex}`);
    } else {
      console.warn(`[Tutorial] Unknown gesture type: ${gesture}`);
    }
  }
  
  private clearGestureHandlers() {
    // Remove all active gesture handlers
    this.currentGestureHandlers.forEach(({ event, handler }) => {
      this.hands.off(event, handler);
    });
    this.currentGestureHandlers = [];
    
    // Clear check intervals
    if (this.twoHandCheckInterval) {
      clearInterval(this.twoHandCheckInterval);
      this.twoHandCheckInterval = null;
    }
    if (this.grabCheckInterval) {
      clearInterval(this.grabCheckInterval);
      this.grabCheckInterval = null;
    }
    
    // Clear skip interval
    if ((this as any).skipCheckInterval) {
      clearInterval((this as any).skipCheckInterval);
      (this as any).skipCheckInterval = null;
    }
    
    // Clear hint timeout
    if ((this as any).hintTimeoutId) {
      clearTimeout((this as any).hintTimeoutId);
      (this as any).hintTimeoutId = null;
    }
    
    // Clear current timeout
    if ((this as any).currentTimeoutId) {
      clearTimeout((this as any).currentTimeoutId);
      (this as any).currentTimeoutId = null;
    }
    
    // Clear fade interval
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    
    // Clear advance timeout
    if ((this as any).advanceTimeout) {
      clearTimeout((this as any).advanceTimeout);
      (this as any).advanceTimeout = null;
    }
  }

  private nextStep() {
    console.log(`[Tutorial] Moving from step ${this.currentStepIndex} to step ${this.currentStepIndex + 1}`);
    this.showStep(this.currentStepIndex + 1);
  }

  private updatePanel() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const step = this.steps[this.currentStepIndex];
    if (!step) return;
    
    // Background - green tint if completed
    if (step.completed) {
      ctx.fillStyle = 'rgba(20, 50, 30, 0.95)';
    } else {
      ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    }
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Title with emoji support
    ctx.fillStyle = step.completed ? '#4ade80' : '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    
    // Split title into emoji and text if needed
    const titleParts = step.title.match(/^([\u{1F300}-\u{1F9FF}]+)?\s*(.+)$/u);
    if (titleParts && titleParts[1]) {
      // Emoji first, then text
      ctx.font = 'bold 56px sans-serif';
      ctx.fillText(titleParts[1], this.canvas.width / 2 - 150, 80);
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(titleParts[2].trim(), this.canvas.width / 2 + 50, 80);
    } else {
      ctx.fillText(step.title, this.canvas.width / 2, 80);
    }
    
    // Success checkmark if completed
    if (step.completed) {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('✓', this.canvas.width / 2 + 250, 80);
      
      // Add celebration emoji
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText('🎉', this.canvas.width / 2 - 250, 80);
    }

    // Description with helpful hints
    ctx.font = '24px sans-serif';
    ctx.fillStyle = step.completed ? '#4ade80' : '#aaa';
    
    // Word wrap description if too long
    const maxWidth = this.canvas.width - 100;
    const words = step.description.split(' ');
    let line = '';
    let y = 140;
    const lineHeight = 30;
    
    words.forEach((word, i) => {
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
    
    // Add helpful tips for specific steps
    let tip = '';
    if (!step.completed && step.gesture) {
      if (step.id === 'rotate') {
        tip = 'Tip: Move your hands in a circular motion';
      } else if (step.id === 'scale') {
        tip = 'Tip: Bring hands together to shrink, apart to enlarge';
      } else if (step.id === 'grab') {
        tip = 'Tip: Pinch near the object, then move your hand';
      } else if (step.id === 'heart') {
        tip = 'Tip: Touch index fingers together, then thumbs';
      } else if (step.id === 'like') {
        tip = 'Tip: Extend your thumb while keeping fingers curled';
      } else if (step.id === 'peace') {
        tip = 'Tip: Extend index and middle fingers like a peace sign';
      } else if (step.id === 'scroll') {
        tip = 'Tip: Pinch away from the object and move up or down';
      }
      
      if (tip) {
        ctx.font = '18px sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText(tip, this.canvas.width / 2, y + lineHeight + 10);
      }
    }
    
    // Completion message with animation hint
    if (step.completed) {
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#4ade80';
      ctx.fillText('✅ Step Complete!', this.canvas.width / 2, 180);
      
      // Pulsing effect for completion
      const pulse = Math.sin(Date.now() / 200) * 0.1 + 0.9;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(
        this.canvas.width / 2 - 50,
        185,
        100,
        3
      );
      ctx.globalAlpha = 1.0;
    }

    // Progress bar for rotation/scale steps
    if ((step.id === 'rotate' || step.id === 'scale') && !step.completed && this.progressPercentage > 0) {
      const barWidth = this.canvas.width * 0.8;
      const barHeight = 8;
      const barX = (this.canvas.width - barWidth) / 2;
      const barY = this.canvas.height - 80;
      
      // Background bar
      ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      // Progress bar
      const progressWidth = (barWidth * this.progressPercentage) / 100;
      const gradient = ctx.createLinearGradient(barX, barY, barX + progressWidth, barY);
      gradient.addColorStop(0, '#4ECDC4');
      gradient.addColorStop(1, '#95E1D3');
      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY, progressWidth, barHeight);
      
      // Progress text
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(this.progressPercentage)}%`, this.canvas.width / 2, barY - 10);
    }
    
    // Progress with completed count
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#888';
    const completedCount = this.steps.filter(s => s.completed).length;
    const totalSteps = this.steps.length;
    
    // Don't show progress for welcome/completion steps
    if (step.id !== 'welcome' && step.id !== 'completion') {
      ctx.fillText(
        `Step ${this.currentStepIndex + 1} / ${totalSteps} (${completedCount} completed)`,
        this.canvas.width / 2,
        this.canvas.height - 30
      );
    }
    
    // Skip hint after 5 seconds on any step
    const stepStartTime = (this as any).stepStartTime || 0;
    const timeOnStep = Date.now() - stepStartTime;
    if (timeOnStep > 5000 && !step.completed && step.gesture) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.fillText('💡 Pinch both hands for 2s to skip', this.canvas.width / 2, this.canvas.height - 10);
    }
    
    // Timeout warning after 10 seconds
    if (timeOnStep > 10000 && !step.completed && step.gesture) {
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#ffaa00';
      ctx.textAlign = 'center';
      ctx.fillText('⏱️ Taking too long? Try the skip gesture!', this.canvas.width / 2, this.canvas.height - 35);
    }
    
    // Instructions for button interaction (hand gestures)
    if (this.currentStepIndex > 0 || this.currentStepIndex < this.steps.length - 1) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.fillText('👆 Point with index finger, pinch to click buttons', this.canvas.width / 2, this.canvas.height - 100);
    }
    
    // Draw navigation buttons
    this.drawNavigationButtons(ctx);

    this.texture.needsUpdate = true;
  }
  
  private drawNavigationButtons(ctx: CanvasRenderingContext2D) {
    const buttonWidth = 120;
    const buttonHeight = 40;
    const buttonY = this.canvas.height - 60;
    const buttonSpacing = 20;
    const totalWidth = buttonWidth * 2 + buttonSpacing;
    const startX = (this.canvas.width - totalWidth) / 2;
    
    // Initialize button regions if not already done
    if (!this.buttonRegions) {
      this.buttonRegions = { prev: { x: 0, y: 0, w: 0, h: 0 }, next: { x: 0, y: 0, w: 0, h: 0 } };
    }
    
    // Previous button
    const prevX = startX;
    const prevEnabled = this.currentStepIndex > 0;
    const prevHovered = this.hoveredButton === 'prev';
    const prevAlpha = prevEnabled ? 1.0 : 0.5;
    
    ctx.globalAlpha = prevAlpha;
    // Highlight hovered button with brighter color
    ctx.fillStyle = prevHovered ? '#5EDDD5' : (prevEnabled ? '#4ECDC4' : '#666');
    ctx.fillRect(prevX, buttonY, buttonWidth, buttonHeight);
    
    // Button border - thicker and brighter when hovered
    ctx.strokeStyle = prevHovered ? '#fff' : (prevEnabled ? '#fff' : '#888');
    ctx.lineWidth = prevHovered ? 3 : 2;
    ctx.strokeRect(prevX, buttonY, buttonWidth, buttonHeight);
    
    // Add glow effect when hovered
    if (prevHovered) {
      ctx.shadowColor = '#5EDDD5';
      ctx.shadowBlur = 10;
      ctx.strokeRect(prevX, buttonY, buttonWidth, buttonHeight);
      ctx.shadowBlur = 0;
    }
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◀ Previous', prevX + buttonWidth / 2, buttonY + buttonHeight / 2 + 7);
    
    // Store button region for click detection
    this.buttonRegions.prev = { x: prevX, y: buttonY, w: buttonWidth, h: buttonHeight };
    
    // Next button
    const nextX = startX + buttonWidth + buttonSpacing;
    const nextEnabled = this.currentStepIndex < this.steps.length - 1;
    const nextHovered = this.hoveredButton === 'next';
    const nextAlpha = nextEnabled ? 1.0 : 0.5;
    
    ctx.globalAlpha = nextAlpha;
    // Highlight hovered button with brighter color
    ctx.fillStyle = nextHovered ? '#5EDDD5' : (nextEnabled ? '#4ECDC4' : '#666');
    ctx.fillRect(nextX, buttonY, buttonWidth, buttonHeight);
    
    // Button border - thicker and brighter when hovered
    ctx.strokeStyle = nextHovered ? '#fff' : (nextEnabled ? '#fff' : '#888');
    ctx.lineWidth = nextHovered ? 3 : 2;
    ctx.strokeRect(nextX, buttonY, buttonWidth, buttonHeight);
    
    // Add glow effect when hovered
    if (nextHovered) {
      ctx.shadowColor = '#5EDDD5';
      ctx.shadowBlur = 10;
      ctx.strokeRect(nextX, buttonY, buttonWidth, buttonHeight);
      ctx.shadowBlur = 0;
    }
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Next ▶', nextX + buttonWidth / 2, buttonY + buttonHeight / 2 + 7);
    
    // Store button region for click detection
    this.buttonRegions.next = { x: nextX, y: buttonY, w: buttonWidth, h: buttonHeight };
    
    ctx.globalAlpha = 1.0;
  }
  

  private complete() {
    this.clearGestureHandlers(); // Clean up handlers when tutorial completes
    
    // Show completion message on panel before hiding
    this.updateCompletionPanel();
    
    console.log('[Tutorial] Tutorial completed!');
    
    // Wait a moment to show completion screen, then hide and call onComplete
    setTimeout(() => {
      this.group.visible = false;
      
      // Restore feed to first non-tutorial item (or original index if we have one)
      const targetIndex = this.firstNonTutorialIndex > 0 ? 
        Math.min(this.firstNonTutorialIndex, this.store.items.length - 1) : 
        Math.min(this.originalFeedIndex, this.store.items.length - 1);
      
      // Ensure target index is valid
      if (targetIndex >= 0 && targetIndex < this.store.items.length) {
        if (this.store.index !== targetIndex) {
          this.store.index = targetIndex;
          this.store.setTargetTransform(1, 0); // Reset transform
          this.store.showCurrent().catch(err => {
            console.error('[Tutorial] Error showing feed after tutorial:', err);
          });
        }
      } else {
        console.warn(`[Tutorial] Invalid target index ${targetIndex}, using 0`);
        if (this.store.items.length > 0) {
          this.store.index = 0;
          this.store.setTargetTransform(1, 0);
          this.store.showCurrent().catch(err => {
            console.error('[Tutorial] Error showing feed after tutorial:', err);
          });
        }
      }
      
      if (this.onComplete) {
        this.onComplete();
      }
    }, 2000); // Show completion for 2 seconds
  }
  
  private updateCompletionPanel() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Celebration background
    const gradient = ctx.createRadialGradient(
      this.canvas.width / 2, this.canvas.height / 2, 0,
      this.canvas.width / 2, this.canvas.height / 2, this.canvas.width / 2
    );
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.3)');
    gradient.addColorStop(1, 'rgba(20, 20, 30, 0.95)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Title
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎉 Tutorial Complete!', this.canvas.width / 2, 120);
    
    // Success message
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.fillText('You\'re all set!', this.canvas.width / 2, 180);
    
    // Instructions
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Explore your feed now', this.canvas.width / 2, 220);
    
    // Progress
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#888';
    const completedCount = this.steps.filter(s => s.completed).length;
    ctx.fillText(
      `Completed ${completedCount} / ${this.steps.length} steps`,
      this.canvas.width / 2,
      this.canvas.height - 30
    );
    
    this.texture.needsUpdate = true;
  }

  async show(camera: THREE.Camera) {
    // Reset tutorial state
    this.currentStepIndex = 0;
    this.progressPercentage = 0;
    this.panelOpacity = 1.0;
    this.steps.forEach(step => step.completed = false);
    
    // Reset material opacity
    if ((this.group as any).panelMaterial) {
      (this.group as any).panelMaterial.opacity = 1.0;
    }
    
    // Save original feed index before starting tutorial
    this.originalFeedIndex = this.store.index;
    
    // Find tutorial items in feed (must be called after feed loads)
    const hasTutorialItems = this.findTutorialItems();
    
    if (!hasTutorialItems) {
      // No tutorial items found, skip tutorial
      console.warn('[Tutorial] No tutorial items found, skipping tutorial');
      this.complete();
      return;
    }
    
    console.log(`[Tutorial] Starting tutorial with ${this.steps.length} steps`);
    console.log(`[Tutorial] Tutorial items: ${this.tutorialItemIndices.length}, First non-tutorial index: ${this.firstNonTutorialIndex}`);
    
    this.group.visible = true;
    
    // Position tutorial panel at fixed location (not floating)
    // Place it 1.5m in front of camera at start, but don't update it
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(pos);
    camera.getWorldDirection(dir);
    this.group.position.copy(pos.add(dir.multiplyScalar(1.5)));
    this.group.position.y += 0.3;
    
    // Face camera initially
    this.group.lookAt(camera.position);
    
    // Start showing tutorial steps (starts with welcome step at index 0)
    await this.showStep(0);
  }

  hide() {
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.group.visible;
  }
  
  updatePosition(position: THREE.Vector3, cameraPosition: THREE.Vector3) {
    // Update tutorial panel position and make it face the camera
    // DISABLED: Tutorial panel is now fixed position, not floating
    // this.group.position.copy(position);
    // this.group.lookAt(cameraPosition);
  }
  
  // Raycast hit test for button clicks
  raycast(ray: THREE.Ray): { button?: 'prev' | 'next' } | null {
    if (!this.group.visible || !this.panel) return null;
    
    try {
      const raycaster = new THREE.Raycaster(ray.origin, ray.direction.normalize());
      const intersects = raycaster.intersectObject(this.panel, false);
      
      if (!intersects || intersects.length === 0) return null;
      
      const intersect = intersects[0];
      if (!intersect.uv) return null;
      
      const uv = intersect.uv;
      const x = uv.x * this.canvas.width;
      const y = (1 - uv.y) * this.canvas.height; // Flip Y coordinate
      
      // Debug logging (throttled)
      if (Math.random() < 0.01) { // 1% of calls
        console.log(`[Tutorial] Raycast hit: x=${x.toFixed(0)}, y=${y.toFixed(0)}, buttonRegions=${!!this.buttonRegions}`);
      }
      
      // Check button regions
      if (this.buttonRegions) {
        const prev = this.buttonRegions.prev;
        if (x >= prev.x && x <= prev.x + prev.w &&
            y >= prev.y && y <= prev.y + prev.h &&
            this.currentStepIndex > 0) {
          console.log(`[Tutorial] Previous button hit!`);
          return { button: 'prev' };
        }
        
        const next = this.buttonRegions.next;
        if (x >= next.x && x <= next.x + next.w &&
            y >= next.y && y <= next.y + next.h &&
            this.currentStepIndex < this.steps.length - 1) {
          console.log(`[Tutorial] Next button hit!`);
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

