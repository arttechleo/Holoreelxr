/**
 * InteractionManager - Production-ready unified interaction system
 * 
 * Single source of truth for all UI and 3D interactions in WebXR.
 * 
 * Architecture:
 * - Input → Raycast/Touch → Target Selection → Action Dispatch
 * - UI always has priority over 3D
 * - Deterministic hit detection (no ambiguous results)
 * - Clear separation of concerns
 * 
 * Usage:
 * 1. Register interaction targets (UI panels, 3D objects)
 * 2. Call processInteraction() each frame with hand position/ray
 * 3. System handles priority, hit detection, and action dispatch
 */

import * as THREE from 'three';

export type InteractionType = 'ui' | '3d';
export type InteractionAction = 'click' | 'hover' | 'grab' | 'scroll' | 'transform';

export interface InteractionTarget {
  /** Unique identifier */
  id: string;
  
  /** Type: UI or 3D */
  type: InteractionType;
  
  /** Priority (higher = checked first). UI typically 100+, 3D typically <100 */
  priority: number;
  
  /** Check if this target is currently active/visible */
  isActive(): boolean;
  
  /** Perform raycast against this target. Returns hit data or null */
  raycast(ray: THREE.Ray): InteractionHit | null;
  
  /** Check touch/proximity interaction (for keyboard/virtual touch) */
  checkTouch?(position: THREE.Vector3): InteractionHit | null;
  
  /** Handle interaction hit. Returns true if handled. */
  handleHit(hit: InteractionHit, action: InteractionAction, isPinching: boolean): boolean;
  
  /** Get visual feedback position for this target (for ray visualization) */
  getVisualPosition?(): THREE.Vector3 | null;
}

export interface InteractionHit {
  /** Target that was hit */
  targetId: string;
  
  /** Hit point in world space */
  point: THREE.Vector3;
  
  /** Distance from ray origin to hit point */
  distance: number;
  
  /** Additional hit data (button name, object reference, etc.) */
  data?: any;
}

export interface InteractionResult {
  /** Whether interaction was handled */
  handled: boolean;
  
  /** Type of target that was hit (or null if none) */
  targetType: InteractionType | null;
  
  /** Hit data (if any) */
  hit: InteractionHit | null;
  
  /** Action that was performed */
  action: InteractionAction | null;
}

export class InteractionManager {
  private targets: InteractionTarget[] = [];
  private lastHit: InteractionHit | null = null;
  private activeUITargets: Set<string> = new Set();
  
  /**
   * Register an interaction target
   */
  register(target: InteractionTarget): void {
    // Remove if already registered
    this.unregister(target.id);
    
    this.targets.push(target);
    // Sort by priority (highest first), then by type (UI before 3D)
    this.targets.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Same priority: UI before 3D
      if (a.type !== b.type) {
        return a.type === 'ui' ? -1 : 1;
      }
      return 0;
    });
    
    // Track UI targets
    if (target.type === 'ui' && target.isActive()) {
      this.activeUITargets.add(target.id);
    }
  }
  
  /**
   * Unregister an interaction target
   */
  unregister(targetId: string): void {
    const index = this.targets.findIndex(t => t.id === targetId);
    if (index >= 0) {
      this.targets.splice(index, 1);
    }
    this.activeUITargets.delete(targetId);
  }
  
  /**
   * Process interaction: raycast + touch detection
   * Returns interaction result with handled status
   */
  processInteraction(
    ray: THREE.Ray,
    touchPosition: THREE.Vector3 | null,
    isPinching: boolean,
    action: InteractionAction = 'click'
  ): InteractionResult {
    // Update active UI targets
    this.updateActiveUITargets();
    
    // CRITICAL: If any UI is active, only check UI targets (mutually exclusive)
    const hasActiveUI = this.activeUITargets.size > 0;
    const targetsToCheck = hasActiveUI
      ? this.targets.filter(t => t.type === 'ui' && t.isActive())
      : this.targets;
    
    // Try touch first (for keyboard/virtual touch interactions)
    if (touchPosition) {
      for (const target of targetsToCheck) {
        if (target.checkTouch && target.isActive()) {
          const hit = target.checkTouch(touchPosition);
          if (hit) {
            // Touch hit found - handle it
            const handled = target.handleHit(hit, action, isPinching);
            if (handled) {
              this.lastHit = hit;
              return {
                handled: true,
                targetType: target.type,
                hit,
                action
              };
            }
          }
        }
      }
    }
    
    // Try raycast (for all interactions)
    const normalizedRay = new THREE.Ray(
      ray.origin.clone(),
      ray.direction.clone().normalize()
    );
    
    for (const target of targetsToCheck) {
      if (!target.isActive()) continue;
      
      const hit = target.raycast(normalizedRay);
      if (hit) {
        // Hit found - try to handle it
        const handled = target.handleHit(hit, action, isPinching);
        if (handled) {
          this.lastHit = hit;
          return {
            handled: true,
            targetType: target.type,
            hit,
            action
          };
        }
      }
    }
    
    // No hit found
    this.lastHit = null;
    return {
      handled: false,
      targetType: null,
      hit: null,
      action: null
    };
  }
  
  /**
   * Check for hover (without pinching) - for visual feedback
   */
  checkHover(ray: THREE.Ray, touchPosition: THREE.Vector3 | null): InteractionHit | null {
    this.updateActiveUITargets();
    
    const hasActiveUI = this.activeUITargets.size > 0;
    const targetsToCheck = hasActiveUI
      ? this.targets.filter(t => t.type === 'ui' && t.isActive())
      : this.targets;
    
    // Try touch first
    if (touchPosition) {
      for (const target of targetsToCheck) {
        if (target.checkTouch && target.isActive()) {
          const hit = target.checkTouch(touchPosition);
          if (hit) {
            this.lastHit = hit;
            return hit;
          }
        }
      }
    }
    
    // Try raycast
    const normalizedRay = new THREE.Ray(
      ray.origin.clone(),
      ray.direction.clone().normalize()
    );
    
    for (const target of targetsToCheck) {
      if (!target.isActive()) continue;
      
      const hit = target.raycast(normalizedRay);
      if (hit) {
        this.lastHit = hit;
        return hit;
      }
    }
    
    this.lastHit = null;
    return null;
  }
  
  /**
   * Get the last hit (for visual feedback)
   */
  getLastHit(): InteractionHit | null {
    return this.lastHit;
  }
  
  /**
   * Clear the last hit
   */
  clearLastHit(): void {
    this.lastHit = null;
  }
  
  /**
   * Check if any UI target is currently active
   */
  hasActiveUI(): boolean {
    this.updateActiveUITargets();
    return this.activeUITargets.size > 0;
  }
  
  /**
   * Update active UI targets set
   */
  private updateActiveUITargets(): void {
    this.activeUITargets.clear();
    for (const target of this.targets) {
      if (target.type === 'ui' && target.isActive()) {
        this.activeUITargets.add(target.id);
      }
    }
  }
  
  /**
   * Get all active UI targets (for debugging)
   */
  getActiveUITargets(): string[] {
    this.updateActiveUITargets();
    return Array.from(this.activeUITargets);
  }
}

