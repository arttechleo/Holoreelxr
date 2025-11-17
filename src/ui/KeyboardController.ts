/**
 * KeyboardController - Standalone keyboard interaction system
 * Supports both touch (index finger) and raycast (pinch-to-aim) input methods
 */

import * as THREE from 'three';
import { VirtualKeyboard } from './VirtualKeyboard';
import { HandEngine } from '../gestures/HandEngine';

export class KeyboardController {
  private keyboard: VirtualKeyboard;
  private handEngine: HandEngine;
  private scene: THREE.Scene;
  
  // State
  private isActive = false;
  private currentAimedKey: string | null = null;
  private lastPressTime = 0;
  private readonly PRESS_DEBOUNCE_MS = 150;
  
  // Track previous index finger states for touch input
  private lastLeftIndexActive = false;
  private lastRightIndexActive = false;
  
  // Raycast settings
  private readonly RAYCAST_DISTANCE = 1.0; // 1 meter max raycast distance
  private readonly RAYCAST_STEP = 0.01; // 1cm steps for raycast
  
  constructor(keyboard: VirtualKeyboard, handEngine: HandEngine, scene: THREE.Scene) {
    this.keyboard = keyboard;
    this.handEngine = handEngine;
    this.scene = scene;
  }
  
  /**
   * Update keyboard interaction - called every frame
   * NON-BLOCKING - prevents freeze
   */
  update(): void {
    if (!this.isActive || !this.keyboard.isVisible()) {
      this.currentAimedKey = null;
      this.keyboard.clearHover();
      this.lastLeftIndexActive = false;
      this.lastRightIndexActive = false;
      return;
    }
    
    // Update keyboard group matrix for accurate positions
    this.keyboard.getGroup().updateMatrixWorld(true);
    
    // Track index finger states for touch input release detection
    const leftIndex = this.handEngine.indexTip('left');
    const rightIndex = this.handEngine.indexTip('right');
    const leftIndexActive = leftIndex !== null;
    const rightIndexActive = rightIndex !== null;
    
    // Check for index finger release (touch input) - only if we were touching a key
    if (this.currentAimedKey) {
      // Check if index finger was touching and now released
      if (this.lastLeftIndexActive && !leftIndexActive) {
        this.handleKeyPress();
      }
      if (this.lastRightIndexActive && !rightIndexActive) {
        this.handleKeyPress();
      }
    }
    
    this.lastLeftIndexActive = leftIndexActive;
    this.lastRightIndexActive = rightIndexActive;
    
    // Try touch input first (index finger collision), then raycast
    const touchResult = this.checkTouchInput();
    if (touchResult) {
      this.updateAimState(touchResult);
      return;
    }
    
    // Fallback to raycast input (pinch-to-aim)
    const raycastResult = this.checkRaycastInput();
    if (raycastResult) {
      this.updateAimState(raycastResult);
      return;
    }
    
    // No input detected - clear hover
    if (this.currentAimedKey) {
      this.currentAimedKey = null;
      this.keyboard.clearHover();
    }
  }
  
  /**
   * Touch input: Check index finger collision with keys
   */
  private checkTouchInput(): { key: string; mesh: THREE.Mesh } | null {
    // Check both hands
    for (const side of ['left', 'right'] as const) {
      const indexTip = this.handEngine.indexTip(side);
      if (!indexTip) continue;
      
      // Check collision with keyboard
      const collision = this.keyboard.checkCollision(indexTip);
      if (collision) {
        return collision;
      }
    }
    
    return null;
  }
  
  /**
   * Raycast input: Cast ray from pinch position to keyboard
   */
  private checkRaycastInput(): { key: string; mesh: THREE.Mesh } | null {
    // Check both hands for pinch
    for (const side of ['left', 'right'] as const) {
      const isPinching = this.handEngine.state[side].pinch;
      if (!isPinching) continue;
      
      // Get pinch position
      const pinchPos = this.handEngine.pinchMid(side);
      if (!pinchPos) continue;
      
      // Get camera forward direction (or use hand direction)
      const indexTip = this.handEngine.indexTip(side);
      if (!indexTip) continue;
      
      // Calculate ray direction from pinch to index tip (forward direction)
      const rayDirection = indexTip.clone().sub(pinchPos).normalize();
      
      // Cast ray
      const ray = new THREE.Ray(pinchPos, rayDirection);
      const hit = this.keyboard.raycast(ray);
      
      if (hit) {
        return hit;
      }
    }
    
    return null;
  }
  
  /**
   * Update aim state based on detected input
   */
  private updateAimState(result: { key: string; mesh: THREE.Mesh }): void {
    if (result.key !== this.currentAimedKey) {
      // Key changed - update hover
      this.keyboard.clearHover();
      this.currentAimedKey = result.key;
      this.keyboard.hoverKey(result.key);
    }
  }
  
  /**
   * Handle key press (internal method)
   */
  private handleKeyPress(): void {
    if (!this.currentAimedKey) return;
    
    const now = performance.now();
    const timeSinceLastPress = now - this.lastPressTime;
    
    // Debounce check
    if (timeSinceLastPress > this.PRESS_DEBOUNCE_MS) {
      try {
        this.keyboard.pressKey(this.currentAimedKey);
        this.lastPressTime = now;
      } catch (error) {
        console.error('Error pressing key:', error);
      }
    }
    
    // Clear aim state after press
    this.currentAimedKey = null;
    this.keyboard.clearHover();
  }
  
  /**
   * Handle input release (pinch release for raycast mode)
   * Called when pinch ends - if we were aiming at a key, press it
   */
  handleInputRelease(side: 'left' | 'right'): void {
    if (!this.isActive || !this.keyboard.isVisible()) return;
    
    // Pinch was released - if we were aiming at a key, press it
    if (this.currentAimedKey) {
      this.handleKeyPress();
    }
  }
  
  /**
   * Activate keyboard controller
   */
  activate(): void {
    this.isActive = true;
    this.currentAimedKey = null;
    this.lastPressTime = 0;
  }
  
  /**
   * Deactivate keyboard controller
   */
  deactivate(): void {
    this.isActive = false;
    this.currentAimedKey = null;
    this.keyboard.clearHover();
  }
  
  /**
   * Check if controller is active
   */
  isControllerActive(): boolean {
    return this.isActive;
  }
  
  /**
   * Check if currently aiming at a key
   */
  isAimingAtKey(): boolean {
    return this.currentAimedKey !== null;
  }
}

