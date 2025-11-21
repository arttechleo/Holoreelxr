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
  gesture?: string;
  completed: boolean;
}

export class OnboardingTutorial {
  private group = new THREE.Group();
  private currentStepIndex = 0;
  private steps: TutorialStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to HoloreelXR',
      description: 'Experience 3D content in Mixed Reality',
      shape: 'sphere',
      color: '#FF6B6B',
      completed: false,
    },
    {
      id: 'pinch',
      title: 'Pinch to Interact',
      description: 'Pinch thumb and index finger to grab and move objects',
      shape: 'box',
      color: '#4ECDC4',
      gesture: 'pinch',
      completed: false,
    },
    {
      id: 'scroll',
      title: 'Scroll Through Feed',
      description: 'Pinch and move hand up/down to navigate',
      shape: 'pyramid',
      color: '#95E1D3',
      gesture: 'scroll',
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
      id: 'heart',
      title: 'Heart Gesture',
      description: 'Touch index fingers and thumbs together',
      shape: 'box',
      color: '#AA96DA',
      gesture: 'heart',
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
  private currentGestureHandlers: Array<{ event: string; handler: () => void }> = []; // Track active handlers

  constructor(scene: THREE.Scene, hands: HandEngine, store: FeedStore) {
    this.hands = hands;
    this.store = store;
    
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
    // Find the first 3 shape items (sphere, box, pyramid) from feed
    this.tutorialItemIndices = [];
    for (let i = 0; i < this.store.items.length && this.tutorialItemIndices.length < 3; i++) {
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
      // Don't fire if loading or already fired
      if (handlerFired || this.isLoading) {
        return;
      }
      
      // Only proceed if we're still on the same step and gesture matches
      if (this.currentStepIndex === stepIndex && 
          this.steps[stepIndex]?.gesture === expectedGesture) {
        handlerFired = true;
        clearTimeout(timeoutId); // Clear timeout since gesture was detected
        if (this.steps[stepIndex]) {
          this.steps[stepIndex].completed = true;
        }
        this.clearGestureHandlers();
        console.log(`Tutorial step ${stepIndex} completed!`);
        setTimeout(() => this.nextStep(), 1000);
      }
    };
    
    // Register appropriate listeners based on gesture type
    console.log(`[Tutorial] Setting up gesture handler for step ${stepIndex}: ${gesture}`);
    
    if (gesture === 'pinch' || gesture === 'scroll') {
      // For pinch/scroll, listen to both left and right (scroll is just a pinch)
      // Use a debounced handler to prevent rapid fires
      let lastFireTime = 0;
      const debouncedHandler = () => {
        const now = Date.now();
        if (now - lastFireTime < 500) return; // Debounce 500ms
        lastFireTime = now;
        console.log(`[Tutorial] Pinch gesture detected on step ${stepIndex}`);
        handler();
      };
      
      this.hands.on('leftpinchstart', debouncedHandler);
      this.hands.on('rightpinchstart', debouncedHandler);
      this.currentGestureHandlers.push(
        { event: 'leftpinchstart', handler: debouncedHandler },
        { event: 'rightpinchstart', handler: debouncedHandler }
      );
      console.log(`[Tutorial] Registered pinch handlers for step ${stepIndex}`);
    } else if (gesture === 'thumbsup') {
      this.hands.on('thumbsupstart', handler);
      this.currentGestureHandlers.push({ event: 'thumbsupstart', handler });
      console.log(`[Tutorial] Registered thumbsup handler for step ${stepIndex}`);
    } else if (gesture === 'heart') {
      this.hands.on('heartstart', handler);
      this.currentGestureHandlers.push({ event: 'heartstart', handler });
      console.log(`[Tutorial] Registered heart handler for step ${stepIndex}`);
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
  }

  private nextStep() {
    console.log(`[Tutorial] Moving from step ${this.currentStepIndex} to step ${this.currentStepIndex + 1}`);
    this.showStep(this.currentStepIndex + 1);
  }

  private updatePanel() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const step = this.steps[this.currentStepIndex];
    
    // Background
    ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.title, this.canvas.width / 2, 80);

    // Description
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText(step.description, this.canvas.width / 2, 140);

    // Progress
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText(
      `${this.currentStepIndex + 1} / ${this.steps.length}`,
      this.canvas.width / 2,
      this.canvas.height - 30
    );

    this.texture.needsUpdate = true;
  }

  private complete() {
    this.clearGestureHandlers(); // Clean up handlers when tutorial completes
    this.group.visible = false;
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

