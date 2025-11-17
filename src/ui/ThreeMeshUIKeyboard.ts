/**
 * Production-Quality VR Keyboard using three-mesh-ui
 * Properly implements interactive keyboard with pinch-to-aim support
 */

import * as THREE from 'three';
// @ts-ignore - three-mesh-ui doesn't have types
import * as ThreeMeshUI from 'three-mesh-ui';

type KeyboardLayout = string[][];

const QWERTY_LAYOUT: KeyboardLayout = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
  ['Space', 'Post', 'Cancel']
];

export class ThreeMeshUIKeyboard {
  private container: any; // ThreeMeshUI.Block
  private textDisplay: any; // ThreeMeshUI.Text
  private group = new THREE.Group();
  private keys: Map<string, any> = new Map(); // Map of key labels to ThreeMeshUI.Block
  private currentText = '';
  private onSubmit?: (text: string) => void;
  private onCancel?: () => void;
  private onTextChange?: (text: string) => void;
  
  // Font configuration
  private fontFamily = './assets/Roboto-msdf.json';
  private fontTexture = './assets/Roboto-msdf.png';
  
  // Raycaster for interaction
  private raycaster = new THREE.Raycaster();
  
  constructor() {
    this.group.name = 'ThreeMeshUIKeyboard';
    this.group.visible = false;
    this.buildKeyboard();
  }
  
  private buildKeyboard() {
    // Main container
    this.container = new ThreeMeshUI.Block({
      width: 1.4,
      height: 0.9,
      padding: 0.05,
      backgroundColor: new THREE.Color(0x2a2a3a),
      backgroundOpacity: 0.95,
      borderRadius: 0.02,
    });
    
    // Text display at top
    const textBlock = new ThreeMeshUI.Block({
      width: 1.3,
      height: 0.12,
      padding: 0.02,
      backgroundColor: new THREE.Color(0x3a3a4a),
      backgroundOpacity: 1.0,
      borderRadius: 0.01,
      margin: 0.02,
    });
    
    this.textDisplay = new ThreeMeshUI.Text({
      content: 'Type your comment...',
      fontSize: 0.035,
      fontFamily: this.fontFamily,
      fontTexture: this.fontTexture,
      color: new THREE.Color(0xffffff),
    });
    
    textBlock.add(this.textDisplay);
    this.container.add(textBlock);
    
    // Keyboard container - stacks rows vertically
    const keyboardContainer = new ThreeMeshUI.Block({
      width: 1.3,
      height: 0.7,
      padding: 0.01,
      direction: 'column', // Stack rows vertically
      backgroundColor: new THREE.Color(0x1a1a2a),
      backgroundOpacity: 0.8,
      borderRadius: 0.01,
      margin: 0.02,
    });
    
    // Build each row
    QWERTY_LAYOUT.forEach((row) => {
      const rowBlock = new ThreeMeshUI.Block({
        width: 1.25,
        height: 0.12,
        padding: 0.005,
        direction: 'row', // Keys in row horizontally
        justifyContent: 'center',
        alignItems: 'center',
      });
      
      row.forEach((keyLabel) => {
        const key = this.createKey(keyLabel);
        rowBlock.add(key);
        this.keys.set(keyLabel, key);
      });
      
      keyboardContainer.add(rowBlock);
    });
    
    this.container.add(keyboardContainer);
    this.group.add(this.container);
  }
  
  private createKey(keyLabel: string): any {
    // Determine key size
    let keyWidth = 0.08;
    let keyHeight = 0.1;
    
    if (keyLabel === 'Space') {
      keyWidth = 0.3;
    } else if (keyLabel === 'Post' || keyLabel === 'Cancel') {
      keyWidth = 0.12;
    } else if (keyLabel === '⌫') {
      keyWidth = 0.1;
    }
    
    // Create interactive key block
    const key = new ThreeMeshUI.Block({
      width: keyWidth,
      height: keyHeight,
      padding: 0.01,
      backgroundColor: new THREE.Color(0x8a8a9a),
      backgroundOpacity: 1.0,
      borderRadius: 0.01,
      margin: 0.003,
      justifyContent: 'center',
      alignItems: 'center',
    });
    
    // Add text label
    let displayText = keyLabel;
    if (keyLabel === 'Space') displayText = '␣';
    else if (keyLabel === '⌫') displayText = '⌫';
    else if (keyLabel === 'Post') displayText = '✓';
    else if (keyLabel === 'Cancel') displayText = '✕';
    
    const keyText = new ThreeMeshUI.Text({
      content: displayText,
      fontSize: 0.025,
      fontFamily: this.fontFamily,
      fontTexture: this.fontTexture,
      color: new THREE.Color(0xffffff),
    });
    
    key.add(keyText);
    key.userData.keyLabel = keyLabel;
    key.userData.originalColor = 0x8a8a9a;
    
    // Set up interactive states
    key.setupState({
      state: 'hovered',
      attributes: {
        backgroundColor: new THREE.Color(0xaaaacc),
      },
    });
    
    key.setupState({
      state: 'idle',
      attributes: {
        backgroundColor: new THREE.Color(0x8a8a9a),
      },
    });
    
    return key;
  }
  
  private handleKeyPress(keyLabel: string) {
    if (keyLabel === '⌫') {
      this.currentText = this.currentText.slice(0, -1);
    } else if (keyLabel === 'Space') {
      this.currentText += ' ';
    } else if (keyLabel === 'Post') {
      const text = this.currentText.trim();
      if (text) {
        this.onSubmit?.(text);
        this.currentText = '';
        this.updateTextDisplay();
      }
      return;
    } else if (keyLabel === 'Cancel') {
      this.currentText = '';
      this.updateTextDisplay();
      this.onCancel?.();
      return;
    } else {
      if (this.currentText.length < 500) {
        this.currentText += keyLabel.toLowerCase();
      }
    }
    
    this.updateTextDisplay();
    this.onTextChange?.(this.currentText);
  }
  
  private updateTextDisplay() {
    if (this.textDisplay) {
      const displayText = this.currentText || 'Type your comment...';
      const maxChars = 40;
      const visibleText = displayText.length > maxChars 
        ? '...' + displayText.slice(-maxChars)
        : displayText;
      this.textDisplay.set({ content: visibleText });
    }
  }
  
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
    this.updateTextDisplay();
    
    // Reset all keys to idle state
    this.keys.forEach((key) => {
      key.setState('idle');
    });
  }
  
  /**
   * Hide keyboard
   */
  hide() {
    this.group.visible = false;
    this.currentText = '';
    this.updateTextDisplay();
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
   * Set keyboard position
   */
  setPosition(position: THREE.Vector3) {
    this.group.position.copy(position);
  }
  
  /**
   * Orient keyboard to face a point
   */
  lookAt(target: THREE.Vector3) {
    this.group.lookAt(target);
  }
  
  /**
   * Update three-mesh-ui (must be called every frame)
   */
  update() {
    if (this.group.visible) {
      ThreeMeshUI.update();
    }
  }
  
  /**
   * Check collision with hand position
   * Returns the key being aimed at
   */
  checkCollision(handPosition: THREE.Vector3): { key: string; mesh: THREE.Mesh } | null {
    if (!handPosition) return null;
    
    this.group.updateMatrixWorld(true);
    
    let closestKey: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    const maxDistance = 0.08; // 8cm threshold
    
    this.keys.forEach((keyBlock: any, keyLabel: string) => {
      if (!keyBlock) return;
      
      keyBlock.updateMatrixWorld(true);
      
      // Get key center position
      const keyWorldPos = new THREE.Vector3();
      keyBlock.getWorldPosition(keyWorldPos);
      
      const distance = handPosition.distanceTo(keyWorldPos);
      
      if (distance < maxDistance) {
        // Find the actual mesh
        let keyMesh: THREE.Mesh | null = null;
        keyBlock.traverse((child: any) => {
          if (child.isMesh && !keyMesh) {
            keyMesh = child;
          }
        });
        
        if (!keyMesh) {
          keyMesh = keyBlock as any;
        }
        
        if (!closestKey || distance < closestKey.distance) {
          closestKey = { key: keyLabel, mesh: keyMesh, distance };
        }
      }
    });
    
    return closestKey ? { key: closestKey.key, mesh: closestKey.mesh } : null;
  }
  
  /**
   * Raycast against keyboard (for pinch-to-aim)
   */
  raycast(ray: THREE.Ray): { key: string; mesh: THREE.Mesh } | null {
    this.raycaster.ray.copy(ray);
    this.group.updateMatrixWorld(true);
    
    let closestHit: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    
    this.keys.forEach((keyBlock: any, keyLabel: string) => {
      if (!keyBlock) return;
      
      keyBlock.updateMatrixWorld(true);
      
      // Traverse to find meshes
      keyBlock.traverse((child: any) => {
        if (child.isMesh) {
          const intersects = this.raycaster.intersectObject(child, false);
          if (intersects.length > 0) {
            const dist = intersects[0].distance;
            if (!closestHit || dist < closestHit.distance) {
              closestHit = { key: keyLabel, mesh: child, distance: dist };
            }
          }
        }
      });
    });
    
    return closestHit ? { key: closestHit.key, mesh: closestHit.mesh } : null;
  }
  
  /**
   * Hover effect - highlight key
   */
  hoverKey(key: string) {
    const keyBlock = this.keys.get(key);
    if (keyBlock) {
      keyBlock.setState('hovered');
    }
  }
  
  /**
   * Clear hover - reset all keys
   */
  clearHover() {
    this.keys.forEach((keyBlock) => {
      keyBlock.setState('idle');
    });
  }
  
  /**
   * Press key programmatically
   */
  pressKey(key: string) {
    const keyBlock = this.keys.get(key);
    if (keyBlock) {
      // Visual feedback - flash white
      keyBlock.set({
        backgroundColor: new THREE.Color(0xffffff),
      });
      
      // Reset after short delay
      setTimeout(() => {
        keyBlock.setState('idle');
      }, 100);
    }
    
    // Handle the key press
    this.handleKeyPress(key);
  }
  
  /**
   * Get keys map (for KeyboardController)
   */
  getKeys(): Map<string, any> {
    return this.keys;
  }
}
