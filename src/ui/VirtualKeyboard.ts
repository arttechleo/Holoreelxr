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
  ['Cancel', 'Space', 'Enter', 'Post']
];

export class VirtualKeyboard {
  private group = new THREE.Group();
  private keys: Map<string, THREE.Mesh> = new Map();
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private currentText = '';
  private onSubmit?: (text: string) => void;
  private onTextChange?: (text: string) => void;
  
  private readonly KEY_SIZE = 0.045; // Slightly larger for easier VR targeting
  private readonly KEY_GAP = 0.007;
  private readonly KEY_DEPTH = 0.012; // Deeper keys for better depth perception
  
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
        const keyWidth = keyLabel === 'Space' ? this.KEY_SIZE * 2.5 : 
                        keyLabel === 'Post' ? this.KEY_SIZE * 1.5 : 
                        keyLabel === 'Cancel' ? this.KEY_SIZE * 1.5 : 
                        keyLabel === 'Enter' ? this.KEY_SIZE * 1.2 : 
                        this.KEY_SIZE;
        
        const geometry = new THREE.BoxGeometry(keyWidth, this.KEY_SIZE, this.KEY_DEPTH);
        const material = new THREE.MeshStandardMaterial({
          color: keyLabel === 'Post' ? 0x4b83ff : 
                 keyLabel === 'Cancel' ? 0xff4444 : 
                 0x8a8a9a, // Grey buttons for regular keys
          roughness: 0.5,
          metalness: 0.15,
          emissive: keyLabel === 'Post' ? 0x2a4080 : 
                    keyLabel === 'Cancel' ? 0x802020 : 
                    0x404050, // Subtle emissive grey
          emissiveIntensity: 0.2,
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
    
    // Add text display above keyboard with better antialiasing
    const displayGeo = new THREE.PlaneGeometry(0.5, 0.08);
    const displayMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    const display = new THREE.Mesh(displayGeo, displayMat);
    display.position.set(0, 0.15, 0);
    display.renderOrder = 1000; // Render on top
    this.group.add(display);
    
    // Set texture filtering for better antialiasing
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 16; // Max anisotropy for crisp text
    
    this.updateDisplay();
  }

  private createTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256; // Higher res for antialiasing
    canvas.height = 256;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    
    // Enable antialiasing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Clear with transparency
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 120px system-ui, -apple-system, Arial'; // Larger, bolder font
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Display text with proper labels
    let displayText = text;
    if (text === 'Space') displayText = '␣';
    else if (text === '⌫') displayText = '⌫';
    else if (text === 'Enter') displayText = '↵';
    else if (text === 'Post') displayText = '✓';
    else if (text === 'Cancel') displayText = '✕';
    
    ctx.fillText(displayText, 128, 128);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 16;
    
    const material = new THREE.SpriteMaterial({ 
      map: texture, 
      depthTest: false,
      transparent: true,
    });
    return new THREE.Sprite(material);
  }

  private updateDisplay() {
    const ctx = this.canvas.getContext('2d', { alpha: true })!;
    
    // Enable high-quality antialiasing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Clear and draw background with subtle grey
    ctx.fillStyle = '#3a3a4a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Add subtle border
    ctx.strokeStyle = '#5a5a6a';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, this.canvas.width - 4, this.canvas.height - 4);
    
    // White text for high contrast
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 42px system-ui, -apple-system, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const displayText = this.currentText || 'Type your comment...';
    const maxChars = 50;
    const visibleText = displayText.slice(-maxChars);
    
    // Draw text with subpixel positioning for smoother rendering
    ctx.fillStyle = this.currentText ? '#ffffff' : '#aaaaaa'; // Placeholder is lighter grey
    ctx.fillText(visibleText, 20.5, this.canvas.height / 2 + 0.5);
    
    // Cursor (blinking effect could be added)
    if (this.currentText.length < 500) {
      ctx.fillStyle = '#ffffff';
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
   * Check collision with hand position (for direct touch/pinch)
   * Reliable distance-based collision detection
   */
  checkCollision(handPosition: THREE.Vector3): { key: string; mesh: THREE.Mesh } | null {
    if (!handPosition) return null;
    
    let closestKey: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    const maxDistance = 0.05; // 5cm max distance for key detection
    
    this.keys.forEach((mesh, key) => {
      if (!mesh.visible) return;
      
      // Get key world position
      const keyWorldPos = new THREE.Vector3();
      mesh.getWorldPosition(keyWorldPos);
      
      // Simple distance check
      const distance = handPosition.distanceTo(keyWorldPos);
      
      if (distance < maxDistance) {
        // Check if this is the closest key
        if (!closestKey || distance < closestKey.distance) {
          closestKey = { key, mesh, distance };
        }
      }
    });
    
    return closestKey ? { key: closestKey.key, mesh: closestKey.mesh } : null;
  }

  /**
   * Hover effect for key (visual preview before press)
   */
  hoverKey(key: string) {
    const mesh = this.keys.get(key);
    if (!mesh || (mesh as any)._isHovered) return;
    
    const mat = mesh.material as THREE.MeshStandardMaterial;
    (mesh as any)._isHovered = true;
    (mesh as any)._originalScale = mesh.scale.clone();
    
    // Subtle scale up and brighten
    mesh.scale.multiplyScalar(1.08);
    mat.emissiveIntensity = 0.6;
    
    // Brighten the key color slightly
    const originalColor = mesh.userData.originalColor;
    if (key !== 'Post' && key !== 'Cancel') {
      mat.color.setHex(0xaaaacc); // Lighter grey on hover
    }
  }

  /**
   * Clear hover state
   */
  clearHover() {
    this.keys.forEach((mesh) => {
      if ((mesh as any)._isHovered) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.2;
        
        // Restore original color
        const originalColor = mesh.userData.originalColor;
        if (originalColor !== undefined) {
          mat.color.setHex(originalColor);
        }
        
        if ((mesh as any)._originalScale) {
          mesh.scale.copy((mesh as any)._originalScale);
        }
        (mesh as any)._isHovered = false;
      }
    });
  }

  /**
   * Handle key press with enhanced feedback
   */
  pressKey(key: string) {
    const mesh = this.keys.get(key);
    if (!mesh) return;
    
    // Enhanced visual feedback
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const originalColor = mesh.userData.originalColor;
    const originalScale = mesh.scale.clone();
    
    // Bright white flash on press
    mat.color.setHex(0xffffff);
    mat.emissiveIntensity = 1.2;
    
    // Press animation (scale down then bounce back)
    const pressDepth = 0.85;
    mesh.scale.multiplyScalar(pressDepth);
    
    setTimeout(() => {
      mesh.scale.copy(originalScale);
      mesh.scale.multiplyScalar(1.12); // Subtle bounce
    }, 40);
    
    setTimeout(() => {
      mesh.scale.copy(originalScale);
      mat.color.setHex(originalColor);
      mat.emissiveIntensity = 0.2;
    }, 120);
    
    // Handle key action
    if (key === '⌫') {
      this.currentText = this.currentText.slice(0, -1);
    } else if (key === 'Space') {
      this.currentText += ' ';
    } else if (key === 'Enter') {
      this.currentText += '\n';
    } else if (key === 'Cancel') {
      this.cancel();
      return;
    } else if (key === 'Post') {
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

  private cancel() {
    this.currentText = '';
    this.onCancel?.();
  }

  private onCancel?: () => void;

  /**
   * Show keyboard at position
   */
  show(
    position: THREE.Vector3, 
    onSubmit: (text: string) => void, 
    onCancel: () => void,
    onTextChange?: (text: string) => void
  ) {
    this.currentText = '';
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
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

