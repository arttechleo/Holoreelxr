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

  private currentShape?: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private panel?: THREE.Mesh;
  private hands: HandEngine;
  private store: FeedStore;
  private onComplete?: () => void;

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
    this.showStep(0);
  }

  setOnComplete(callback: () => void) {
    this.onComplete = callback;
  }

  showStep(index: number) {
    if (index >= this.steps.length) {
      this.complete();
      return;
    }

    this.currentStepIndex = index;
    const step = this.steps[index];
    
    // Remove previous shape
    if (this.currentShape) {
      this.group.remove(this.currentShape);
      (this.currentShape as any).geometry?.dispose?.();
      (this.currentShape as any).material?.dispose?.();
    }

    // Create new shape
    let geometry: THREE.BufferGeometry;
    if (step.shape === 'sphere') {
      geometry = new THREE.SphereGeometry(0.2, 32, 32);
    } else if (step.shape === 'pyramid') {
      geometry = new THREE.ConeGeometry(0.2, 0.4, 4);
    } else {
      geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    }

    const material = new THREE.MeshStandardMaterial({
      color: step.color,
      metalness: 0.3,
      roughness: 0.7,
    });

    this.currentShape = new THREE.Mesh(geometry, material);
    this.currentShape.position.set(0, 0, 0);
    this.group.add(this.currentShape);

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

  show(camera: THREE.Camera) {
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
  }

  hide() {
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.group.visible;
  }
}

