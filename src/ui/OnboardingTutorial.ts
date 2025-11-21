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
    
    // Use FeedStore to show the corresponding tutorial item
    // Map step index to tutorial item index (first 3 steps use feed items)
    if (index < this.tutorialItemIndices.length) {
      const feedIndex = this.tutorialItemIndices[index];
      this.store.index = feedIndex;
      await this.store.showCurrent();
    }

    // Update panel
    this.updatePanel();

    // Listen for gesture completion
    if (step.gesture) {
      this.waitForGesture(step.gesture);
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
    const handler = () => {
      if (this.steps[this.currentStepIndex].gesture === gesture) {
        this.steps[this.currentStepIndex].completed = true;
        this.hands.off(gesture + 'start', handler);
        setTimeout(() => this.nextStep(), 1000);
      }
    };
    this.hands.on(gesture + 'start', handler);
  }

  private nextStep() {
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

