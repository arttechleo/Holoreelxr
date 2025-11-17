/**
 * KeyboardController - Standalone keyboard interaction system
 * Supports both touch (index finger) and raycast (pinch-to-aim) input methods
 */

import * as THREE from 'three';
import { VirtualKeyboard } from './VirtualKeyboard';
import { HandEngine } from '../gestures/HandEngine';

// Keyboard interface for type safety
interface IKeyboard {
  isVisible(): boolean;
  getGroup(): THREE.Group;
  checkCollision(handPosition: THREE.Vector3): { key: string; mesh: THREE.Mesh } | null;
  raycast(ray: THREE.Ray): { key: string; mesh: THREE.Mesh } | null;
  hoverKey(key: string): void;
  clearHover(): void;
  pressKey(key: string): void;
}

export class KeyboardController {
  private keyboard: IKeyboard;
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
  
  // Track pinch states for pinch-to-aim
  private leftPinchActive = false;
  private rightPinchActive = false;
  
  // Raycast settings
  private readonly RAYCAST_DISTANCE = 1.0; // 1 meter max raycast distance
  private readonly RAYCAST_STEP = 0.01; // 1cm steps for raycast
  
  constructor(keyboard: IKeyboard, handEngine: HandEngine, scene: THREE.Scene) {
    this.keyboard = keyboard;
    this.handEngine = handEngine;
    this.scene = scene;
  }
  
  /**
   * Set active keyboard (allows switching between keyboard types)
   */
  setKeyboard(keyboard: IKeyboard): void {
    this.keyboard = keyboard;
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
    
    // Track pinch states
    const leftPinching = this.handEngine.state['left'].pinch;
    const rightPinching = this.handEngine.state['right'].pinch;
    
    // Try touch input first (index finger collision), then raycast
    const touchResult = this.checkTouchInput();
    if (touchResult) {
      this.updateAimState(touchResult);
      this.leftPinchActive = false;
      this.rightPinchActive = false;
      return;
    }
    
    // Fallback to raycast input (pinch-to-aim)
    const raycastResult = this.checkRaycastInput();
    if (raycastResult) {
      this.updateAimState(raycastResult);
      // Track which hand is pinching
      this.leftPinchActive = leftPinching;
      this.rightPinchActive = rightPinching;
      return;
    }
    
    // No input detected - clear hover and reset pinch tracking
    if (this.currentAimedKey) {
      this.currentAimedKey = null;
      this.keyboard.clearHover();
    }
    this.leftPinchActive = false;
    this.rightPinchActive = false;
  }
  
  /**
   * Touch input: Check index finger collision with keys
   * Works with both VirtualKeyboard and ThreeMeshUIKeyboard
   */
  private checkTouchInput(): { key: string; mesh: THREE.Mesh } | null {
    // Check both hands
    for (const side of ['left', 'right'] as const) {
      const indexTip = this.handEngine.indexTip(side);
      if (!indexTip) continue;
      
      // Check collision with keyboard
      const collision = this.keyboard.checkCollision(indexTip);
      if (collision && collision.key && collision.key !== 'interactive') {
        return collision;
      }
      
      // For three-mesh-ui, we need to check individual keys
      // Get all keys from keyboard if it has a keys map
      if ((this.keyboard as any).keys) {
        const keysMap = (this.keyboard as any).keys as Map<string, any>;
        let closestKey: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
        const maxDistance = 0.06; // 6cm for touch
        
        keysMap.forEach((keyBlock: any, keyLabel: string) => {
          if (!keyBlock || !keyBlock.position) return;
          
          // Get key world position
          const keyWorldPos = new THREE.Vector3();
          keyBlock.getWorldPosition(keyWorldPos);
          
          const distance = indexTip.distanceTo(keyWorldPos);
          if (distance < maxDistance) {
            if (!closestKey || distance < closestKey.distance) {
              closestKey = { key: keyLabel, mesh: keyBlock as any, distance };
            }
          }
        });
        
        if (closestKey) {
          return { key: closestKey.key, mesh: closestKey.mesh };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Raycast input: Cast ray from pinch position to keyboard
   * Works with both VirtualKeyboard and ThreeMeshUIKeyboard
   */
  private checkRaycastInput(): { key: string; mesh: THREE.Mesh } | null {
    // Check both hands for pinch
    for (const side of ['left', 'right'] as const) {
      const isPinching = this.handEngine.state[side].pinch;
      if (!isPinching) continue;
      
      // Get pinch position
      const pinchPos = this.handEngine.pinchMid(side);
      if (!pinchPos) continue;
      
      // Get index tip for ray direction
      const indexTip = this.handEngine.indexTip(side);
      if (!indexTip) continue;
      
      // Calculate ray direction from pinch to index tip (forward direction)
      const rayDirection = indexTip.clone().sub(pinchPos).normalize();
      
      // Cast ray using keyboard's raycast method
      const ray = new THREE.Ray(pinchPos, rayDirection);
      const hit = this.keyboard.raycast(ray);
      
      if (hit && hit.key && hit.key !== 'interactive') {
        return hit;
      }
      
      // For three-mesh-ui, also check individual keys with raycast
      // Use the keyboard's own raycast method which handles three-mesh-ui properly
      // The keyboard.raycast() already handles three-mesh-ui traversal
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
    
    // Check if this hand was pinching and aiming at a key
    const wasPinching = side === 'left' ? this.leftPinchActive : this.rightPinchActive;
    
    // Pinch was released - if we were aiming at a key, press it
    if (wasPinching && this.currentAimedKey) {
      this.handleKeyPress();
    }
    
    // Reset pinch state for this hand
    if (side === 'left') {
      this.leftPinchActive = false;
    } else {
      this.rightPinchActive = false;
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
    this.leftPinchActive = false;
    this.rightPinchActive = false;
    this.lastLeftIndexActive = false;
    this.lastRightIndexActive = false;
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

