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
  gesture?: string; // 'twohandrotate', 'twohandscale', 'grab', 'heart', 'thumbsup', 'peace', 'scroll'
  completed: boolean;
}

export class OnboardingTutorial {
  private group = new THREE.Group();
  private currentStepIndex = 0;
  private originalFeedIndex: number = 0;
  private firstNonTutorialIndex: number = 0;
  
  // Comprehensive tutorial steps with detailed instructions
  private steps: TutorialStep[] = [
    {
      id: 'welcome',
      title: '🎉 Welcome to HoloreelXR!',
      description: 'Your immersive 3D social feed experience',
      detailedInstructions: 'This tutorial will teach you how to interact with 3D content using hand gestures. Point at buttons with your index finger and pinch to click. Let\'s begin!',
      shape: 'box',
      color: '#667eea',
      completed: false,
    },
    {
      id: 'basics',
      title: '👆 Hand Gesture Basics',
      description: 'Point and pinch to interact',
      detailedInstructions: 'Point at the "Next" button below with your index finger. When it highlights, pinch your thumb and index finger together to click it. Try it now!',
      shape: 'box',
      color: '#4ECDC4',
      completed: false,
    },
    {
      id: 'rotate',
      title: '🔄 Rotate 3D Objects',
      description: 'Two-hand rotation',
      detailedInstructions: 'Pinch with BOTH hands on the cube. Move your hands in a circular motion to rotate it. Rotate at least 30 degrees to complete this step.',
      shape: 'box',
      color: '#4ECDC4',
      gesture: 'twohandrotate',
      completed: false,
    },
    {
      id: 'scale',
      title: '📏 Scale Objects',
      description: 'Two-hand scaling',
      detailedInstructions: 'Pinch with BOTH hands on the cube. Move your hands closer together to shrink it, or farther apart to enlarge it. Change the size to complete this step.',
      shape: 'box',
      color: '#95E1D3',
      gesture: 'twohandscale',
      completed: false,
    },
    {
      id: 'grab',
      title: '✋ Grab and Move',
      description: 'Single-hand grab',
      detailedInstructions: 'Pinch with ONE hand near the cube (within 15cm). Hold for 1 second, then move your hand to reposition the cube. Release the pinch to place it.',
      shape: 'box',
      color: '#FF6B6B',
      gesture: 'grab',
      completed: false,
    },
    {
      id: 'scroll',
      title: '📜 Scroll Feed',
      description: 'Navigate content',
      detailedInstructions: 'Pinch with ONE hand away from the object (more than 50cm). Move your hand UP or DOWN to scroll through the feed. Try scrolling now!',
      shape: 'sphere',
      color: '#6BCF7F',
      gesture: 'scroll',
      completed: false,
    },
    {
      id: 'like',
      title: '👍 Like Content',
      description: 'Thumbs up gesture',
      detailedInstructions: 'Extend your thumb upward while keeping your other fingers curled. Hold the thumbs up gesture for a moment to like the content.',
      shape: 'sphere',
      color: '#F38181',
      gesture: 'thumbsup',
      completed: false,
    },
    {
      id: 'heart',
      title: '❤️ Save Content',
      description: 'Heart gesture',
      detailedInstructions: 'Bring BOTH hands together. Touch your index fingers together, then touch your thumbs together. Hold for a moment to save the content.',
      shape: 'box',
      color: '#AA96DA',
      gesture: 'heart',
      completed: false,
    },
    {
      id: 'repost',
      title: '✌️ Repost Content',
      description: 'Peace sign gesture',
      detailedInstructions: 'Extend your index and middle fingers (peace sign) while keeping your ring and pinky fingers curled. Hold the gesture to repost.',
      shape: 'pyramid',
      color: '#FFD93D',
      gesture: 'peace',
      completed: false,
    },
    {
      id: 'complete',
      title: '🎊 Tutorial Complete!',
      description: 'You\'re ready to explore!',
      detailedInstructions: 'Congratulations! You\'ve learned all the basic gestures. You can now explore your feed freely. Use the gestures you learned to interact with content!',
      shape: 'box',
      color: '#667eea',
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
  private twoHandCheckInterval: number | null = null;
  private grabCheckInterval: number | null = null;
  private feedControls: any = null;
  private currentGestureHandlers: Array<{ event: string; handler: () => void }> = [];
  private progressPercentage: number = 0;
  private panelOpacity: number = 1.0;
  private fadeInterval: number | null = null;
  private buttonRegions: { prev: { x: number; y: number; w: number; h: number }; next: { x: number; y: number; w: number; h: number } } | null = null;
  private hoveredButton: 'prev' | 'next' | null = null;
  private rotationInitialValue: number | null = null;
  private rotationTrackingActive = false;

  constructor(scene: THREE.Scene, hands: HandEngine, store: FeedStore, feedControls?: any) {
    this.hands = hands;
    this.store = store;
    this.feedControls = feedControls;
    
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 600;
    const ctx = this.canvas.getContext('2d')!;
    
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
    
    this.panel.userData = { tutorial: this };
    
    scene.add(this.group);
  }
  
  setFeedControls(controls: any) {
    this.feedControls = controls;
  }
  
  setOnComplete(callback: () => void) {
    this.onComplete = callback;
  }
  
  // Set hover state for visual feedback
  setButtonHover(button: 'prev' | 'next' | null) {
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      this.updatePanel();
    }
  }
  
  // Handle button clicks (triggered by pinch gesture)
  handleButtonClick(buttonType: 'prev' | 'next'): boolean {
    if (!this.group.visible || this.isLoading) return false;
    
    console.log(`[Tutorial] Button clicked: ${buttonType}`);
    
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
    
    console.log(`[Tutorial] Found ${this.tutorialItemIndices.length} tutorial items, first non-tutorial at index ${this.firstNonTutorialIndex}`);
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
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    
    this.rotationTrackingActive = false;
    this.rotationInitialValue = null;
  }

  private async showStep(index: number) {
    if (index < 0 || index >= this.steps.length) {
      console.warn(`[Tutorial] Invalid step index: ${index}`);
      return;
    }
    
    this.currentStepIndex = index;
    const step = this.steps[index];
    
    this.progressPercentage = 0;
    this.clearGestureHandlers();
    
    console.log(`[Tutorial] Showing step ${index + 1}/${this.steps.length}: ${step.title}`);
    
    // Update panel immediately
    this.updatePanel();
    
    // Handle welcome and complete steps (no model needed)
    if (step.id === 'welcome' || step.id === 'complete' || step.id === 'basics') {
      // Just show the panel, no model loading needed
      this.group.visible = true;
      if (step.gesture) {
        this.waitForGesture(step.gesture);
      }
      return;
    }
    
    // For other steps, load the appropriate model
    const tutorialItemIndex = index - 2; // Account for welcome and basics steps
    if (tutorialItemIndex >= 0 && tutorialItemIndex < this.tutorialItemIndices.length) {
      const feedIndex = this.tutorialItemIndices[tutorialItemIndex];
      this.isLoading = true;
      
      try {
        this.store.index = feedIndex;
        await this.store.showCurrent();
        this.isLoading = false;
        
        // Initialize rotation tracking for rotate step
        if (step.id === 'rotate') {
          setTimeout(() => {
            this.rotationInitialValue = this.store.rotationY;
            this.rotationTrackingActive = true;
            console.log(`[Tutorial] Rotation tracking initialized: ${this.rotationInitialValue}`);
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
      if (this.isLoading || this.currentStepIndex !== stepIndex) {
        return;
      }
      
      if (this.currentStepIndex === stepIndex && 
          this.steps[stepIndex]?.gesture === expectedGesture) {
        
        handlerFired = true;
        this.clearGestureHandlers();
        
        if (this.steps[stepIndex]) {
          this.steps[stepIndex].completed = true;
        }
        
        this.updatePanel();
        
        setTimeout(() => {
          if (this.currentStepIndex === stepIndex) {
            this.nextStep();
          }
        }, 1500);
      }
    };
    
    // Rotation detection
    if (gesture === 'twohandrotate') {
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.twoHandCheckInterval) {
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        if (!this.rotationTrackingActive || this.rotationInitialValue === null) {
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
          handlerFired = true;
          handler();
        }
      }, 100);
    }
    // Scale detection
    else if (gesture === 'twohandscale') {
      let initialScale = this.store.scale;
      let scaleSet = false;
      
      setTimeout(() => {
        initialScale = this.store.scale;
        scaleSet = true;
      }, 500);
      
      this.twoHandCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex || !scaleSet) {
          if (this.twoHandCheckInterval) {
            clearInterval(this.twoHandCheckInterval);
            this.twoHandCheckInterval = null;
          }
          return;
        }
        
        const currentScale = this.store.scale;
        const scaleChange = Math.abs(currentScale - initialScale);
        
        if (scaleChange > 0.1) {
          handlerFired = true;
          handler();
        }
      }, 100);
    }
    // Grab detection
    else if (gesture === 'grab') {
      this.grabCheckInterval = window.setInterval(() => {
        if (handlerFired || this.isLoading || this.currentStepIndex !== stepIndex) {
          if (this.grabCheckInterval) {
            clearInterval(this.grabCheckInterval);
            this.grabCheckInterval = null;
          }
          return;
        }
        
        const grabbing = (this.feedControls as any)?.grabbing;
        if (grabbing) {
          handlerFired = true;
          handler();
        }
      }, 200);
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
        
        if (this.store.index !== lastIndex) {
          handlerFired = true;
          handler();
        }
        lastIndex = this.store.index;
      }, 200);
    }
    // Gesture-based detections
    else if (gesture === 'thumbsup') {
      const thumbsUpHandler = () => {
        if (!handlerFired && this.currentStepIndex === stepIndex) {
          handlerFired = true;
          handler();
        }
      };
      this.hands.on('thumbsupstart', thumbsUpHandler);
      this.currentGestureHandlers.push({ event: 'thumbsupstart', handler: thumbsUpHandler });
    }
    else if (gesture === 'heart') {
      const heartHandler = () => {
        if (!handlerFired && this.currentStepIndex === stepIndex) {
          handlerFired = true;
          handler();
        }
      };
      this.hands.on('heartstart', heartHandler);
      this.currentGestureHandlers.push({ event: 'heartstart', handler: heartHandler });
    }
    else if (gesture === 'peace') {
      const peaceHandler = () => {
        if (!handlerFired && this.currentStepIndex === stepIndex) {
          handlerFired = true;
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
    
    // Instructions for button interaction
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('👆 Point with index finger, pinch to click buttons', this.canvas.width / 2, this.canvas.height - 20);

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

  async show(camera: THREE.Camera) {
    this.currentStepIndex = 0;
    this.progressPercentage = 0;
    this.panelOpacity = 1.0;
    this.steps.forEach(step => step.completed = false);
    
    if ((this.group as any).panelMaterial) {
      (this.group as any).panelMaterial.opacity = 1.0;
    }
    
    this.originalFeedIndex = this.store.index;
    this.findTutorialItems();
    
    this.group.visible = true;
    
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
  
  // Raycast hit test for button clicks
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
