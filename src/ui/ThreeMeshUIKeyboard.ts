/**
 * ThreeMeshUI Keyboard - Production-ready VR keyboard using three-mesh-ui library
 * Provides smooth, optimized keyboard experience for VR
 * Based on: https://felixmariotto.github.io/three-mesh-ui/#keyboard
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
  ['Cancel', 'Space', 'Enter', 'Post']
];

export class ThreeMeshUIKeyboard {
  private container: any; // ThreeMeshUI.Block
  private keyboardContainer: any; // ThreeMeshUI.Block for keys
  private textBlock: any; // ThreeMeshUI.Block for text display
  private textContent: any; // ThreeMeshUI.Text
  private group = new THREE.Group();
  private keys: Map<string, any> = new Map(); // Map of key labels to ThreeMeshUI.Button
  private currentText = '';
  private onSubmit?: (text: string) => void;
  private onCancel?: () => void;
  private onTextChange?: (text: string) => void;
  
  // Font configuration - using default or provided fonts
  private fontFamily = './assets/Roboto-msdf.json';
  private fontTexture = './assets/Roboto-msdf.png';
  
  constructor() {
    this.group.name = 'ThreeMeshUIKeyboard';
    this.group.visible = false;
    this.buildKeyboard();
  }
  
  private buildKeyboard() {
    // Create main container
    this.container = new ThreeMeshUI.Block({
      width: 1.4,
      height: 0.9,
      padding: 0.05,
      backgroundColor: new THREE.Color(0x2a2a3a),
      backgroundOpacity: 0.95,
      borderRadius: 0.02,
    });
    
    // Create text display area at top
    this.textBlock = new ThreeMeshUI.Block({
      width: 1.3,
      height: 0.12,
      padding: 0.02,
      backgroundColor: new THREE.Color(0x3a3a4a),
      backgroundOpacity: 1.0,
      borderRadius: 0.01,
      margin: 0.02,
    });
    
    this.textContent = new ThreeMeshUI.Text({
      content: 'Type your comment...',
      fontSize: 0.035,
      fontFamily: this.fontFamily,
      fontTexture: this.fontTexture,
      color: new THREE.Color(0xffffff),
    });
    
    this.textBlock.add(this.textContent);
    this.container.add(this.textBlock);
    
    // Create keyboard container
    this.keyboardContainer = new ThreeMeshUI.Block({
      width: 1.3,
      height: 0.7,
      padding: 0.01,
      backgroundColor: new THREE.Color(0x1a1a2a),
      backgroundOpacity: 0.8,
      borderRadius: 0.01,
      margin: 0.02,
    });
    
    // Build keyboard rows
    this.buildKeyboardRows();
    
    this.container.add(this.keyboardContainer);
    this.group.add(this.container);
  }
  
  private buildKeyboardRows() {
    QWERTY_LAYOUT.forEach((row, rowIndex) => {
      const rowBlock = new ThreeMeshUI.Block({
        width: 1.25,
        height: 0.12,
        padding: 0.005,
        justifyContent: 'center',
        alignItems: 'center',
      });
      
      row.forEach((keyLabel) => {
        const keyButton = this.createKeyButton(keyLabel);
        rowBlock.add(keyButton);
        this.keys.set(keyLabel, keyButton);
      });
      
      this.keyboardContainer.add(rowBlock);
    });
  }
  
  private createKeyButton(keyLabel: string): any {
    // Determine key size
    let keyWidth = 0.08;
    let keyHeight = 0.1;
    
    if (keyLabel === 'Space') {
      keyWidth = 0.25;
    } else if (keyLabel === 'Post' || keyLabel === 'Cancel') {
      keyWidth = 0.12;
    } else if (keyLabel === 'Enter') {
      keyWidth = 0.12;
    } else if (keyLabel === '⌫') {
      keyWidth = 0.1;
    }
    
    // Create button
    const button = new ThreeMeshUI.Block({
      width: keyWidth,
      height: keyHeight,
      padding: 0.01,
      backgroundColor: new THREE.Color(0x8a8a9a),
      backgroundOpacity: 1.0,
      borderRadius: 0.01,
      margin: 0.003,
    });
    
    // Add text label
    let displayText = keyLabel;
    if (keyLabel === 'Space') displayText = '␣';
    else if (keyLabel === '⌫') displayText = '⌫';
    else if (keyLabel === 'Enter') displayText = '↵';
    else if (keyLabel === 'Post') displayText = '✓';
    else if (keyLabel === 'Cancel') displayText = '✕';
    
    const keyText = new ThreeMeshUI.Text({
      content: displayText,
      fontSize: 0.025,
      fontFamily: this.fontFamily,
      fontTexture: this.fontTexture,
      color: new THREE.Color(0xffffff),
    });
    
    button.add(keyText);
    button.userData.keyLabel = keyLabel;
    button.userData.originalColor = 0x8a8a9a;
    
    // Store button reference
    return button;
  }
  
  private handleKeyPress(key: string) {
    if (key === 'Backspace') {
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
    
    this.updateTextDisplay();
    this.onTextChange?.(this.currentText);
  }
  
  private updateTextDisplay() {
    if (this.textContent) {
      const displayText = this.currentText || 'Type your comment...';
      const maxChars = 40;
      const visibleText = displayText.length > maxChars 
        ? '...' + displayText.slice(-maxChars)
        : displayText;
      this.textContent.set({ content: visibleText });
    }
  }
  
  private submit() {
    const text = this.currentText.trim();
    if (text) {
      this.onSubmit?.(text);
      this.currentText = '';
      this.updateTextDisplay();
    }
  }
  
  private cancel() {
    this.currentText = '';
    this.updateTextDisplay();
    this.onCancel?.();
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
   * Detects which key the hand is closest to
   */
  checkCollision(handPosition: THREE.Vector3): { key: string; mesh: THREE.Mesh } | null {
    if (!handPosition) return null;
    
    let closestKey: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    const maxDistance = 0.08; // 8cm max distance - more forgiving for VR hand tracking
    
    this.keys.forEach((keyBlock: any, keyLabel: string) => {
      if (!keyBlock || !keyBlock.position) return;
      
      // Update matrix world for accurate positions
      this.group.updateMatrixWorld(true);
      keyBlock.updateMatrixWorld(true);
      
      // Get key world position
      const keyWorldPos = new THREE.Vector3();
      keyBlock.getWorldPosition(keyWorldPos);
      
      const distance = handPosition.distanceTo(keyWorldPos);
      
      if (distance < maxDistance) {
        if (!closestKey || distance < closestKey.distance) {
          closestKey = { key: keyLabel, mesh: keyBlock as any, distance };
        }
      }
    });
    
    return closestKey ? { key: closestKey.key, mesh: closestKey.mesh } : null;
  }
  
  /**
   * Raycast against keyboard (for pinch-to-aim)
   * Detects which key the ray intersects
   */
  raycast(ray: THREE.Ray): { key: string; mesh: THREE.Mesh } | null {
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(ray);
    
    // Update matrix world for accurate positions
    this.group.updateMatrixWorld(true);
    
    let closestHit: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    
    // Raycast against each key
    this.keys.forEach((keyBlock: any, keyLabel: string) => {
      if (!keyBlock) return;
      
      keyBlock.updateMatrixWorld(true);
      
      // Raycast against key block
      const intersects = raycaster.intersectObject(keyBlock, false);
      if (intersects.length > 0) {
        const dist = intersects[0].distance;
        if (!closestHit || dist < closestHit.distance) {
          closestHit = { key: keyLabel, mesh: keyBlock as any, distance: dist };
        }
      }
    });
    
    return closestHit ? { key: closestHit.key, mesh: closestHit.mesh } : null;
  }
  
  /**
   * Hover effect - highlight key
   */
  hoverKey(key: string) {
    const keyButton = this.keys.get(key);
    if (keyButton) {
      keyButton.set({
        backgroundColor: new THREE.Color(0xaaaacc),
      });
    }
  }
  
  /**
   * Clear hover - reset all keys
   */
  clearHover() {
    this.keys.forEach((keyButton) => {
      const originalColor = keyButton.userData.originalColor || 0x8a8a9a;
      keyButton.set({
        backgroundColor: new THREE.Color(originalColor),
      });
    });
  }
  
  /**
   * Press key programmatically
   */
  pressKey(key: string) {
    const keyButton = this.keys.get(key);
    if (keyButton) {
      // Visual feedback - flash white
      keyButton.set({
        backgroundColor: new THREE.Color(0xffffff),
      });
      
      // Reset after short delay
      setTimeout(() => {
        const originalColor = keyButton.userData.originalColor || 0x8a8a9a;
        keyButton.set({
          backgroundColor: new THREE.Color(originalColor),
        });
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

