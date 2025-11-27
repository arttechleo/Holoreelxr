/**
 * VRKeypad - Virtual Touch Keyboard for WebXR Text Input
 *
 * KEYBOARD HOLD FIX + VISUAL PRIORITY
 * ===================================
 *
 * ARCHITECTURE:
 * - Every key is a collider (defined by key regions)
 * - When index finger collider overlaps key collider → trigger exactly ONE key press
 * - No auto-repeat while finger stays on key (must leave + re-enter)
 * - Small debounce (150ms per key) prevents jitter double-typing
 * - Immediate text field updates via callback (real-time UI sync)
 *
 * VISUAL PRIORITY:
 * - Keyboard plane uses depthTest=true & renderOrder=30000 to be above 3D models
 * - Hands render at ~50000, so they appear in front of keyboard
 * - 3D models are faded when keyboard is active (handled by FeedControls)
 * - Keyboard is always readable and hands are always visible
 *
 * INTEGRATION:
 * - FeedControls calls processFingerTouches(), which handles touch detection + debouncing
 * - FeedControls blocks 3D interactions whenever keyboard is visible
 * - Keyboard logic is centralized inside this class (touch detection + text updates)
 */

import * as THREE from 'three';

export type KeypadKey = 
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  | '-' | 'backspace' | 'clear' | 'connect' | 'cancel';

interface KeyRegion {
  key: KeypadKey;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class VRKeypad {
  private group = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  
  // Key regions for collider detection
  private keyRegions: KeyRegion[] = [];
  
  // Panel dimensions
  private readonly PANEL_W = 0.8;  // 80cm wide
  private readonly PANEL_H = 0.6; // 60cm tall
  private readonly CANVAS_W = 1024;
  private readonly CANVAS_H = 768;
  
  // Touch-based interaction (proximity/collider detection)
  private readonly TOUCH_THRESHOLD = 0.05; // 5cm proximity threshold
  
  // Debouncing (prevents jitter double-typing)
  private readonly KEY_DEBOUNCE_MS = 150; // Per-key debounce time
  private lastKeyPressTime = new Map<KeypadKey, number>(); // Per-key debouncing
  
  // Hit zone padding for easier targeting
  private readonly HIT_ZONE_PADDING = 8;
  
  // State
  private inputText = '';
  private hoveredKey: KeypadKey | null = null;
  private currentTouchKey: KeypadKey | null = null; // Currently touched key
  private activeTouchKey: KeypadKey | null = null; // Key that already fired (requires exit/re-enter)
  private onInputChange?: (text: string) => void;
  private onConnect?: () => void;
  private onCancel?: () => void;
  
  constructor(scene: THREE.Scene) {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.CANVAS_W;
    this.canvas.height = this.CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('VRKeypad: cannot get 2D context');
    this.ctx = ctx;
    
    // Create texture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    // Create plane mesh
    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1.0,
      depthTest: true, // Enable depth test so hands can render in front
      depthWrite: false // Don't write depth (allows hands to render in front)
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    // CRITICAL: Render order high enough to be above 3D models, but hands (renderOrder ~50000) can render in front
    // Hands typically render at ~50000, so keyboard at 30000 ensures it's above models but hands can be in front
    this.panel.renderOrder = 30000;
    this.group.add(this.panel);
    scene.add(this.group);
    
    // Initially hidden
    this.group.visible = false;
    
    // Initial render
    this.render();
  }
  
  /**
   * Show keypad at position
   */
  show(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.visible = true;
    this.group.visible = true;
    this.group.position.copy(position);
    this.group.lookAt(lookAt);
    this.hoveredKey = null;
    this.currentTouchKey = null;
    this.activeTouchKey = null;
    this.render(); // Render to set up key regions
    
    // CRITICAL: Sync keypad inputText with panel's joinInputCode if callback exists
    if (this.onInputChange) {
      this.onInputChange(this.inputText);
    }
    
    console.log('[VRKeypad] ✅ Keypad shown, inputText:', this.inputText);
  }
  
  /**
   * Hide keypad
   */
  hide(): void {
    this.visible = false;
    this.group.visible = false;
    this.hoveredKey = null;
    this.currentTouchKey = null;
    this.activeTouchKey = null;
  }
  
  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
  }
  
  /**
   * Set input change callback
   */
  onInput(callback: (text: string) => void): void {
    this.onInputChange = callback;
  }
  
  /**
   * Set connect callback
   */
  onConnectClick(callback: () => void): void {
    this.onConnect = callback;
  }
  
  /**
   * Set cancel callback
   */
  onCancelClick(callback: () => void): void {
    this.onCancel = callback;
  }
  
  /**
   * Get current input text
   */
  getInputText(): string {
    return this.inputText;
  }
  
  /**
   * Set input text (for external updates)
   */
  setInputText(text: string): void {
    const oldText = this.inputText;
    this.inputText = text;
    
    // If text changed, notify callback to sync with panel
    if (oldText !== text && this.onInputChange) {
      try {
        this.onInputChange(this.inputText);
      } catch (error) {
        console.error('[VRKeypad] Error in input change callback (setInputText):', error);
      }
    }
    
    this.render();
  }
  
  /** 
   * Set hovered key (for visual feedback)
   */
  setHoveredKey(key: KeypadKey | null): void {
    if (this.hoveredKey !== key) {
      this.hoveredKey = key;
      this.render();
    }
  }
  
  /** 
   * Update position to face camera
   */
  update(camera: THREE.Camera): void {
    if (!this.visible) return;
    
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    
    // Smoothly face camera
    this.group.lookAt(camPos);
  }
  
  /**
   * Process finger touches (centralized keyboard interaction logic)
   * CRITICAL: One press per distinct touch - finger must leave and re-enter to trigger again
   * @param fingerTips Array of finger world positions (supports multiple hands)
   * @returns { active: boolean, pressedKey: KeypadKey | null }
   */
  processFingerTouches(fingerTips: Array<THREE.Vector3 | null>): { active: boolean; pressedKey: KeypadKey | null } {
    if (!this.visible) {
      this.clearTouchState();
      return { active: false, pressedKey: null };
    }
    
    // Find which key (if any) is currently being touched
    let keyTouched: KeypadKey | null = null;
    for (const tip of fingerTips) {
      if (!tip) continue;
      keyTouched = this.getKeyForFinger(tip);
      if (keyTouched) break;
    }
    
    // CRITICAL: If finger left the key, reset activeTouchKey to allow re-entry
    if (!keyTouched) {
      // Finger is not touching any key - clear active state to allow re-entry
      if (this.activeTouchKey !== null) {
        this.activeTouchKey = null; // Reset so finger can re-enter and trigger again
      }
      this.clearTouchState();
      return { active: false, pressedKey: null };
    }
    
    // Finger is touching a key
    this.currentTouchKey = keyTouched;
    this.setHoveredKey(keyTouched);
    
    // CRITICAL: Only trigger if this is a NEW touch (finger entered key, or switched to different key)
    // activeTouchKey tracks which key already fired - must be null or different key to trigger
    if (this.activeTouchKey !== keyTouched) {
      // New key touched (or finger re-entered after leaving) - check debounce and trigger
      if (this.canPressKey(keyTouched)) {
        this.activeTouchKey = keyTouched; // Mark this key as having fired
        this.lastKeyPressTime.set(keyTouched, performance.now());
        this.handleKeyPress(keyTouched);
        console.log('[VRKeypad] ✅ Key pressed:', keyTouched);
        return { active: true, pressedKey: keyTouched };
      }
    }
    
    // Finger is still on the same key that already fired - no repeat (prevents spam)
    return { active: true, pressedKey: null };
  }
  
  /**
   * Handle key press - updates input text and triggers callback IMMEDIATELY
   */
  handleKeyPress(key: KeypadKey): boolean {
    let inputChanged = false;
    
    // Handle key action
    if (key === 'backspace') {
      if (this.inputText.length > 0) {
        this.inputText = this.inputText.slice(0, -1);
        inputChanged = true;
      }
    } else if (key === 'clear') {
      this.inputText = '';
      inputChanged = true;
    } else if (key === 'connect') {
      this.onConnect?.();
      return true;
    } else if (key === 'cancel') {
      this.onCancel?.();
      return true;
    } else {
      // Regular key - add to input
      if (this.inputText.length < 30) {
        this.inputText += key;
        inputChanged = true;
      }
    }
    
    // CRITICAL: Call input change callback IMMEDIATELY to update UI text field
    if (inputChanged) {
      this.render(); // Update on-keyboard display immediately
    }
    
    if (inputChanged && this.onInputChange) {
      try {
        console.log('[VRKeypad] 🔔 Key pressed:', key, '→ Text:', this.inputText);
        this.onInputChange(this.inputText);
        console.log('[VRKeypad] ✅ Callback completed, text field should be updated');
      } catch (error) {
        console.error('[VRKeypad] ❌ Error in input change callback:', error);
      }
    }
    
    return true;
  }
  
  /**
   * Check if keyboard is active (for disabling 3D interaction)
   */
  isActive(): boolean {
    return this.visible;
  }
  
  /**
   * Render keypad
   */
  private render(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Background - neutral grey
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, w, h);
    
    // Border - white
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    
    // Title - white
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ENTER PEER ID', w / 2, 50);
    
    // Input display
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(this.inputText || '...', w / 2, 110);
    
    // Draw keys
    this.keyRegions = [];
    const keySize = 60;
    const keySpacing = 10;
    const startX = 50;
    const startY = 150;
    
    // Row 1: 0-9
    const row1 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as KeypadKey[];
    this.drawKeyRow(ctx, row1, startX, startY, keySize, keySpacing);
    
    // Row 2: a-j
    const row2 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as KeypadKey[];
    this.drawKeyRow(ctx, row2, startX, startY + keySize + keySpacing, keySize, keySpacing);
    
    // Row 3: k-t
    const row3 = ['k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'] as KeypadKey[];
    this.drawKeyRow(ctx, row3, startX, startY + (keySize + keySpacing) * 2, keySize, keySpacing);
    
    // Row 4: u-z, dash
    const row4 = ['u', 'v', 'w', 'x', 'y', 'z', '-'] as KeypadKey[];
    this.drawKeyRow(ctx, row4, startX, startY + (keySize + keySpacing) * 3, keySize, keySpacing);
    
    // Row 5: Control keys
    const controlY = startY + (keySize + keySpacing) * 4;
    this.drawKey(ctx, 'backspace', startX, controlY, keySize * 2, keySize, '⌫');
    this.drawKey(ctx, 'clear', startX + (keySize + keySpacing) * 2.5, controlY, keySize * 2, keySize, 'CLEAR');
    this.drawKey(ctx, 'cancel', startX + (keySize + keySpacing) * 5, controlY, keySize * 2.5, keySize, 'CANCEL', '#666666');
    this.drawKey(ctx, 'connect', startX + (keySize + keySpacing) * 7.8, controlY, keySize * 2.5, keySize, 'CONNECT', '#888888');
    
    // Update texture
    this.texture.needsUpdate = true;
  }
  
  /**
   * Draw a row of keys
   */
  private drawKeyRow(ctx: CanvasRenderingContext2D, keys: KeypadKey[], x: number, y: number, size: number, spacing: number): void {
    keys.forEach((key, i) => {
      this.drawKey(ctx, key, x + i * (size + spacing), y, size, size, key.toUpperCase());
    });
  }
  
  /**
   * Draw a single key (grey/white styling)
   */
  private drawKey(ctx: CanvasRenderingContext2D, key: KeypadKey, x: number, y: number, w: number, h: number, label: string, color: string = '#555555'): void {
    const isHovered = this.hoveredKey === key;
    
    // Store region for collider detection
    this.keyRegions.push({ key, x, y, w, h });
    
    // Key background
    if (key === 'cancel') {
      ctx.fillStyle = isHovered ? '#ffffff' : '#444444';
    } else if (key === 'connect') {
      ctx.fillStyle = isHovered ? '#ffffff' : '#666666';
    } else {
      ctx.fillStyle = isHovered ? '#ffffff' : color;
    }
    ctx.fillRect(x, y, w, h);
    
    // Key border
    ctx.strokeStyle = isHovered ? '#ffffff' : '#888888';
    ctx.lineWidth = isHovered ? 4 : 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    
    // Key label
    ctx.fillStyle = isHovered ? '#000000' : '#ffffff';
    ctx.font = isHovered ? 'bold 32px Arial' : '28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }
  
  /**
   * Cleanup
   */
  dispose(): void {
    this.texture.dispose();
    this.panel.geometry.dispose();
    this.panel.material.dispose();
  }
  /**
   * Convert finger position to local key (if any)
   */
  private getKeyForFinger(fingerPosition: THREE.Vector3): KeypadKey | null {
    try {
      if (!this.group || !this.group.parent) return null;
      
      const localPos = new THREE.Vector3();
      this.group.worldToLocal(localPos.copy(fingerPosition));
      
      const distToPlane = Math.abs(localPos.z);
      if (distToPlane > this.TOUCH_THRESHOLD) return null;
      
      const dx = localPos.x;
      const dy = localPos.y;
      if (Math.abs(dx) > this.PANEL_W * 0.5 || Math.abs(dy) > this.PANEL_H * 0.5) return null;
      
      const u = (dx / this.PANEL_W) + 0.5;
      const v = 0.5 - (dy / this.PANEL_H);
      const px = u * this.CANVAS_W;
      const py = v * this.CANVAS_H;
      
      if (!this.keyRegions || this.keyRegions.length === 0) return null;
      
      for (const region of this.keyRegions) {
        if (!region) continue;
        const expandedX = region.x - this.HIT_ZONE_PADDING;
        const expandedY = region.y - this.HIT_ZONE_PADDING;
        const expandedW = region.w + (this.HIT_ZONE_PADDING * 2);
        const expandedH = region.h + (this.HIT_ZONE_PADDING * 2);
        
        if (px >= expandedX && px <= expandedX + expandedW &&
            py >= expandedY && py <= expandedY + expandedH) {
          return region.key;
        }
      }
    } catch (error) {
      console.error('[VRKeypad] Error in getKeyForFinger:', error);
    }
    return null;
  }
  
  /**
   * Reset hover + touch state when no keys are touched
   * CRITICAL: activeTouchKey is reset in processFingerTouches when finger leaves
   */
  private clearTouchState(): void {
    this.currentTouchKey = null;
    // Note: activeTouchKey is reset in processFingerTouches when keyTouched becomes null
    // This allows finger to re-enter and trigger again
    this.setHoveredKey(null);
  }
}
