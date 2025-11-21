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
  private steps: TutorialStep[] = [
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
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.position.set(0, 0.4, 0);
    this.group.add(this.panel);
    
    scene.add(this.group);
    // Tutorial items will be found when show() is called (after feed loads)
  }
  
  private findTutorialItems() {
    // Find the first 7 shape items for tutorial steps
    this.tutorialItemIndices = [];
    for (let i = 0; i < this.store.items.length && this.tutorialItemIndices.length < 7; i++) {
      const item = this.store.items[i];
      if (item.type === 'shape') {
        this.tutorialItemIndices.push(i);
      }
    }
    return this.tutorialItemIndices.length > 0;
  }

  setOnComplete(callback: () => void) {
    this.onComplete = callback;
  }

  setFeedControls(controls: any) {
    this.feedControls = controls;
  }

  async showStep(index: number) {
    if (index >= this.steps.length) {
      this.complete();
      return;
    }

    this.currentStepIndex = index;
    const step = this.steps[index];
    
    // Set loading state to prevent gesture handlers from firing during transition
    this.isLoading = true;
    this.clearGestureHandlers();
    
    // Use FeedStore to show the corresponding tutorial item
    // Map step index to tutorial item index (first 3 steps use feed items)
    if (index < this.tutorialItemIndices.length) {
      const feedIndex = this.tutorialItemIndices[index];
      
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
        // Clear loading state after shape is ready
        this.isLoading = false;
        // Set up gesture handlers now that loading is complete
        if (this.currentStepIndex === index && step.gesture) {
          this.waitForGesture(step.gesture);
        }
      });
    } else {
      // No model to load, clear loading immediately
      this.isLoading = false;
    }

    // Update panel
    this.updatePanel();

    // Listen for gesture completion
    if (step.gesture) {
      // If no model to load, set up handlers immediately
      if (index >= this.tutorialItemIndices.length) {
        this.waitForGesture(step.gesture);
      }
      // Otherwise, handlers will be set up in requestAnimationFrame above
    } else {
      // Auto-advance after 3 seconds for welcome step
      setTimeout(() => {
        if (this.currentStepIndex === index) {
          this.nextStep();
        }
      }, 3000);
    }
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
    
    // Add timeout to prevent freezing - auto-skip after 15 seconds (reduced from 30)
    const timeoutId = setTimeout(() => {
      if (!handlerFired && this.currentStepIndex === stepIndex && !this.isLoading) {
        console.warn(`Tutorial step ${stepIndex} timed out, auto-advancing...`);
        handlerFired = true;
        if (this.steps[stepIndex]) {
          this.steps[stepIndex].completed = true;
        }
        this.clearGestureHandlers();
        this.nextStep();
      }
    }, 15000); // 15 second timeout (reduced for faster progression)
    
    const handler = () => {
      // Don't fire if loading or already fired - but allow if handlerFired was set by interval
      if (this.isLoading) {
        console.log(`[Tutorial] Handler blocked: isLoading=${this.isLoading}`);
        return;
      }
      
      // Only proceed if we're still on the same step and gesture matches
      if (this.currentStepIndex === stepIndex && 
          this.steps[stepIndex]?.gesture === expectedGesture &&
          !this.steps[stepIndex]?.completed) {
        console.log(`[Tutorial] Handler executing for step ${stepIndex}, gesture: ${expectedGesture}`);
        
        // Set handlerFired to prevent multiple calls
        handlerFired = true;
        clearTimeout(timeoutId); // Clear timeout since gesture was detected
        
        // Mark step as completed
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
        setTimeout(() => {
          // Double-check we're still on the same step before advancing
          if (this.currentStepIndex === stepIndex) {
            console.log(`[Tutorial] Advancing to next step from step ${stepIndex}`);
            this.nextStep();
          } else {
            console.log(`[Tutorial] Step changed during delay (current: ${this.currentStepIndex}), skipping advance`);
          }
        }, 1500); // Slightly longer delay to show completion
      } else {
        console.log(`[Tutorial] Handler skipped: currentStepIndex=${this.currentStepIndex}, stepIndex=${stepIndex}, gesture=${this.steps[stepIndex]?.gesture}, expected=${expectedGesture}, completed=${this.steps[stepIndex]?.completed}`);
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
      // Check for two-hand rotation - require 60° (1/6 rotation) for tutorial - enough to demonstrate feature without being too difficult
      let lastRotY = this.store.rotationY;
      let rotationDetected = false;
      let rotationStartTime = 0;
      let totalRotation = 0; // Track cumulative rotation
      let initialRotY = this.store.rotationY; // Track starting rotation
      let lastProgressLog = 0; // Track last progress log to avoid spam
      const REQUIRED_ROTATION = Math.PI / 3; // 60 degrees - good tutorial balance (demonstrates feature, not too difficult)
      
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
        const currentRotY = this.store.rotationY;
        const now = Date.now();
        
        // Debug logging every 2 seconds to help diagnose issues
        if (now % 2000 < 100) {
          console.log(`[Tutorial] Rotation check: lp=${lp}, rp=${rp}, currentRotY=${currentRotY.toFixed(4)}, totalRotation=${totalRotation.toFixed(4)} rad (${(totalRotation * 180 / Math.PI).toFixed(1)}°), handlerFired=${handlerFired}, isLoading=${this.isLoading}`);
        }
        
        if (lp && rp) {
          // Initialize rotation tracking when both hands start pinching
          if (!rotationDetected) {
            rotationDetected = true;
            rotationStartTime = now;
            initialRotY = currentRotY;
            totalRotation = 0;
            lastRotY = currentRotY; // Initialize lastRotY to current
            console.log(`[Tutorial] 🔄 Both hands pinching - rotation tracking started: initial=${initialRotY.toFixed(4)}`);
          }
          
          // Both hands pinching - check if rotation changed
          // Handle wrap-around (rotation goes from 2π to 0 or vice versa)
          let rotDelta = currentRotY - lastRotY;
          
          // Handle wrap-around: normalize to [-π, π] range
          while (rotDelta > Math.PI) rotDelta -= 2 * Math.PI;
          while (rotDelta < -Math.PI) rotDelta += 2 * Math.PI;
          
          // Track rotation direction (positive = clockwise, negative = counter-clockwise)
          const absDelta = Math.abs(rotDelta);
          
          // Only count significant rotation (ignore jitter)
          if (absDelta > 0.005) {
            totalRotation += absDelta;
            console.log(`[Tutorial] Rotation detected: delta=${absDelta.toFixed(4)} rad (${(absDelta * 180 / Math.PI).toFixed(1)}°), total=${totalRotation.toFixed(4)} rad (${(totalRotation * 180 / Math.PI).toFixed(1)}°)`);
          }
          
          // Calculate progress percentage
          const progress = (totalRotation / REQUIRED_ROTATION) * 100;
          
          // Complete when 60° rotation is achieved OR any rotation after 3 seconds (fallback for struggling users)
          const timeHeld = now - rotationStartTime;
          const hasEnoughRotation = totalRotation >= REQUIRED_ROTATION;
          const hasAnyRotationWithTime = totalRotation > 0.1 && timeHeld > 3000; // At least 0.1 rad (~6°) after 3 seconds
          
          if (hasEnoughRotation || hasAnyRotationWithTime) {
            if (!handlerFired && this.currentStepIndex === stepIndex) {
              const rotationType = hasEnoughRotation ? '60° rotation' : 'fallback (any rotation + time)';
              console.log(`[Tutorial] ✅ ROTATION COMPLETE! Step ${stepIndex} - ${rotationType} - total=${totalRotation.toFixed(4)} rad (${(totalRotation * 180 / Math.PI).toFixed(1)}°), required=${(REQUIRED_ROTATION * 180 / Math.PI).toFixed(1)}°, time=${timeHeld}ms`);
              console.log(`[Tutorial] Calling handler() to mark step complete...`);
              
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
                console.log(`[Tutorial] Handler called successfully`);
              } catch (error) {
                console.error(`[Tutorial] Error calling handler:`, error);
                // If handler fails, manually advance step
                if (this.currentStepIndex === stepIndex && this.steps[stepIndex]) {
                  this.steps[stepIndex].completed = true;
                  this.clearGestureHandlers();
                  setTimeout(() => this.nextStep(), 500);
                }
              }
              
              return;
            }
          } else {
            // Log progress every 25% for feedback (avoid spam)
            const progressPercent = Math.floor(progress / 25) * 25;
            if (progressPercent > lastProgressLog && progressPercent > 0) {
              lastProgressLog = progressPercent;
              console.log(`[Tutorial] Rotation progress: ${progressPercent}% (${totalRotation.toFixed(4)} rad / ${REQUIRED_ROTATION.toFixed(4)} rad = ${(totalRotation * 180 / Math.PI).toFixed(1)}° / ${(REQUIRED_ROTATION * 180 / Math.PI).toFixed(1)}°)`);
            }
          }
          
          lastRotY = currentRotY;
        } else {
          // Reset if hands not pinching - but keep progress if they resume quickly
          if (rotationDetected) {
            const timeSinceStart = now - rotationStartTime;
            // If hands released but rotation was in progress, reset after 1 second (shorter timeout)
            if (timeSinceStart > 1000) {
              console.log(`[Tutorial] Hands released for >1s, resetting rotation detection (progress lost: ${totalRotation.toFixed(4)} rad = ${(totalRotation * 180 / Math.PI).toFixed(1)}°)`);
              rotationDetected = false;
              totalRotation = 0;
              lastProgressLog = 0;
              initialRotY = currentRotY;
            }
          }
          lastRotY = currentRotY;
        }
      }, 100);
      console.log(`[Tutorial] Registered two-hand rotate detector for step ${stepIndex} - requires 60° rotation (${REQUIRED_ROTATION.toFixed(4)} rad) for tutorial`);
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
      }, 100);
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

    // Title
    ctx.fillStyle = step.completed ? '#4ade80' : '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.title, this.canvas.width / 2, 80);
    
    // Success checkmark if completed
    if (step.completed) {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 60px sans-serif';
      ctx.fillText('✓', this.canvas.width / 2 + 200, 80);
    }

    // Description
    ctx.font = '24px sans-serif';
    ctx.fillStyle = step.completed ? '#4ade80' : '#aaa';
    ctx.fillText(step.description, this.canvas.width / 2, 140);
    
    // Completion message
    if (step.completed) {
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#4ade80';
      ctx.fillText('Step Complete!', this.canvas.width / 2, 180);
    }

    // Progress with completed count
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#888';
    const completedCount = this.steps.filter(s => s.completed).length;
    ctx.fillText(
      `Step ${this.currentStepIndex + 1} / ${this.steps.length} (${completedCount} completed)`,
      this.canvas.width / 2,
      this.canvas.height - 30
    );

    this.texture.needsUpdate = true;
  }

  private complete() {
    this.clearGestureHandlers(); // Clean up handlers when tutorial completes
    this.group.visible = false;
    console.log('[Tutorial] Tutorial completed!');
    if (this.onComplete) {
      this.onComplete();
    }
  }

  async show(camera: THREE.Camera) {
    // Find tutorial items in feed (must be called after feed loads)
    const hasTutorialItems = this.findTutorialItems();
    
    if (!hasTutorialItems) {
      // No tutorial items found, skip tutorial
      this.complete();
      return;
    }
    
    this.group.visible = true;
    
    // Position 1.5m in front of camera
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(pos);
    camera.getWorldDirection(dir);
    this.group.position.copy(pos.add(dir.multiplyScalar(1.5)));
    this.group.position.y += 0.3;
    
    // Face camera
    this.group.lookAt(camera.position);
    
    // Start showing tutorial steps
    await this.showStep(0);
  }

  hide() {
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.group.visible;
  }
}

