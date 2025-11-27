/**
 * UnifiedInteractionSystem - Centralized interaction routing with clear priority rules
 * 
 * Priority Rules:
 * 1. If UI panel is active/visible → UI wins (tutorial, keypad, multiplayer panel)
 * 2. Otherwise → 3D interactions (grab, scroll, transform, gestures)
 * 
 * This ensures UI elements are always interactive when visible, preventing conflicts.
 */

import * as THREE from 'three';
import { HandEngine } from '../gestures/HandEngine';

export interface InteractionTarget {
  type: 'ui' | '3d';
  priority: number; // Higher = more priority
  handleRaycast(ray: THREE.Ray, isPinching: boolean): boolean; // Returns true if handled
  handleTouch?(position: THREE.Vector3, isPinching: boolean): boolean; // Optional touch support
}

export class UnifiedInteractionSystem {
  private targets: InteractionTarget[] = [];
  
  /**
   * Register an interaction target
   */
  register(target: InteractionTarget): void {
    this.targets.push(target);
    // Sort by priority (highest first)
    this.targets.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Unregister an interaction target
   */
  unregister(target: InteractionTarget): void {
    const index = this.targets.indexOf(target);
    if (index >= 0) {
      this.targets.splice(index, 1);
    }
  }
  
  /**
   * Process interaction: try raycast first, then touch
   * Returns true if interaction was handled
   */
  processInteraction(
    ray: THREE.Ray,
    touchPosition: THREE.Vector3 | null,
    isPinching: boolean
  ): boolean {
    // Try raycast for all targets in priority order
    for (const target of this.targets) {
      if (target.handleRaycast(ray, isPinching)) {
        return true; // Handled
      }
    }
    
    // If raycast didn't handle it, try touch (if available)
    if (touchPosition) {
      for (const target of this.targets) {
        if (target.handleTouch && target.handleTouch(touchPosition, isPinching)) {
          return true; // Handled
        }
      }
    }
    
    return false; // Not handled
  }
  
  /**
   * Check if any UI target is active
   */
  hasActiveUI(): boolean {
    return this.targets.some(t => t.type === 'ui');
  }
}

