/**
 * 3D Virtual Keyboard for WebXR
 * Renders a keyboard in 3D space that can be interacted with via rays/pinch
 */

import * as THREE from 'three';

type KeyboardLayout = string[][];

const QWERTY_LAYOUT: KeyboardLayout = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
  ['Space', 'Submit']
];

export class VirtualKeyboard {
  private group = new THREE.Group();
  private keys: Map<string, THREE.Mesh> = new Map();
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private currentText = '';
  private onSubmit?: (text: string) => void;
  private onTextChange?: (text: string) => void;
  
  private readonly KEY_SIZE = 0.04;
  private readonly KEY_GAP = 0.006;
  private readonly KEY_DEPTH = 0.01;
  
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    
    this.buildKeyboard();
    this.group.visible = false;
  }

  private buildKeyboard() {
    let yOffset = 0;
    
    QWERTY_LAYOUT.forEach((row, rowIndex) => {
      const rowWidth = row.reduce((sum, key) => {
        return sum + (key === 'Space' ? this.KEY_SIZE * 4 : this.KEY_SIZE) + this.KEY_GAP;
      }, 0);
      
      let xOffset = -rowWidth / 2;
      
      row.forEach((keyLabel) => {
        const keyWidth = keyLabel === 'Space' ? this.KEY_SIZE * 4 : 
                        keyLabel === 'Submit' ? this.KEY_SIZE * 2 : 
                        this.KEY_SIZE;
        
        const geometry = new THREE.BoxGeometry(keyWidth, this.KEY_SIZE, this.KEY_DEPTH);
        const material = new THREE.MeshStandardMaterial({
          color: keyLabel === 'Submit' ? 0x4b83ff : 0x2a2a3a,
          roughness: 0.7,
          metalness: 0.1,
        });
        
        const keyMesh = new THREE.Mesh(geometry, material);
        keyMesh.position.set(xOffset + keyWidth / 2, yOffset, 0);
        keyMesh.userData = { key: keyLabel, originalColor: material.color.getHex() };
        
        this.keys.set(keyLabel, keyMesh);
        this.group.add(keyMesh);
        
        // Add text label
        const textSprite = this.createTextSprite(keyLabel);
        textSprite.position.set(xOffset + keyWidth / 2, yOffset, this.KEY_DEPTH / 2 + 0.001);
        textSprite.scale.setScalar(0.02);
        this.group.add(textSprite);
        
        xOffset += keyWidth + this.KEY_GAP;
      });
      
      yOffset -= this.KEY_SIZE + this.KEY_GAP;
    });
    
    // Add text display above keyboard
    const displayGeo = new THREE.PlaneGeometry(0.5, 0.08);
    const displayMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
    });
    const display = new THREE.Mesh(displayGeo, displayMat);
    display.position.set(0, 0.15, 0);
    this.group.add(display);
    
    this.updateDisplay();
  }

  private createTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '72px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text === 'Space' ? '␣' : text === '⌫' ? '⌫' : text, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    return new THREE.Sprite(material);
  }

  private updateDisplay() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '48px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const displayText = this.currentText || 'Type your comment...';
    const maxChars = 50;
    const visibleText = displayText.slice(-maxChars);
    ctx.fillText(visibleText, 20, this.canvas.height / 2);
    
    // Cursor
    if (this.currentText.length < 500) {
      ctx.fillRect(20 + ctx.measureText(visibleText).width + 5, this.canvas.height / 2 - 20, 3, 40);
    }
    
    this.texture.needsUpdate = true;
  }

  /**
   * Raycast against keyboard keys
   */
  raycast(ray: THREE.Ray): { key: string; mesh: THREE.Mesh } | null {
    let closestHit: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    
    this.keys.forEach((mesh, key) => {
      const raycaster = new THREE.Raycaster();
      raycaster.ray.copy(ray);
      
      const intersects = raycaster.intersectObject(mesh);
      if (intersects.length > 0) {
        const dist = intersects[0].distance;
        if (!closestHit || dist < closestHit.distance) {
          closestHit = { key, mesh, distance: dist };
        }
      }
    });
    
    return closestHit ? { key: closestHit.key, mesh: closestHit.mesh } : null;
  }

  /**
   * Handle key press
   */
  pressKey(key: string) {
    const mesh = this.keys.get(key);
    if (!mesh) return;
    
    // Visual feedback
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const originalColor = mesh.userData.originalColor;
    mat.color.setHex(0xffffff);
    setTimeout(() => mat.color.setHex(originalColor), 150);
    
    // Handle key action
    if (key === '⌫') {
      this.currentText = this.currentText.slice(0, -1);
    } else if (key === 'Space') {
      this.currentText += ' ';
    } else if (key === 'Submit') {
      this.submit();
      return;
    } else {
      if (this.currentText.length < 500) {
        this.currentText += key;
      }
    }
    
    this.updateDisplay();
    this.onTextChange?.(this.currentText);
  }

  private submit() {
    const text = this.currentText.trim();
    if (text) {
      this.onSubmit?.(text);
      this.currentText = '';
      this.updateDisplay();
    }
  }

  /**
   * Show keyboard at position
   */
  show(position: THREE.Vector3, onSubmit: (text: string) => void, onTextChange?: (text: string) => void) {
    this.currentText = '';
    this.onSubmit = onSubmit;
    this.onTextChange = onTextChange;
    this.group.position.copy(position);
    this.group.visible = true;
    this.updateDisplay();
  }

  /**
   * Hide keyboard
   */
  hide() {
    this.group.visible = false;
    this.currentText = '';
    this.updateDisplay();
  }

  /**
   * Get the keyboard group for adding to scene
   */
  getGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Check if keyboard is visible
   */
  isVisible(): boolean {
    return this.group.visible;
  }

  /**
   * Set keyboard position (relative to camera or object)
   */
  setPosition(position: THREE.Vector3) {
    this.group.position.copy(position);
  }

  /**
   * Orient keyboard to face a point (usually camera)
   */
  lookAt(target: THREE.Vector3) {
    this.group.lookAt(target);
  }
}

