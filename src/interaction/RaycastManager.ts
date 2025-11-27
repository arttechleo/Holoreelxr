/**
 * RaycastManager - Unified raycast system for UI and 3D interactions
 * 
 * Provides a single, reliable raycast pipeline with clear priority:
 * 1. UI elements (tutorial, multiplayer panel, keypad, HUD) - highest priority
 * 2. 3D objects (grab, scroll, transform) - lower priority
 * 
 * Ensures deterministic hit detection with no ambiguous results.
 */

import * as THREE from 'three';

export interface RaycastTarget {
  /** Unique identifier for this target */
  id: string;
  
  /** Priority level (higher = checked first) */
  priority: number;
  
  /** Type of target (UI or 3D) */
  type: 'ui' | '3d';
  
  /** Check if this target is currently active/visible */
  isActive(): boolean;
  
  /** Perform raycast against this target */
  raycast(ray: THREE.Ray): RaycastHit | null;
  
  /** Handle the hit (called when this target wins) */
  handleHit?(hit: RaycastHit, isPinching: boolean): boolean;
}

export interface RaycastHit {
  /** Target that was hit */
  targetId: string;
  
  /** Type of hit */
  type: 'ui' | '3d';
  
  /** Additional hit data (button name, object reference, etc.) */
  data?: any;
  
  /** Hit point in world space */
  point?: THREE.Vector3;
  
  /** Distance from ray origin to hit point */
  distance?: number;
}

export class RaycastManager {
  private targets: RaycastTarget[] = [];
  private lastHit: RaycastHit | null = null;
  
  /**
   * Register a raycast target
   */
  register(target: RaycastTarget): void {
    // Remove if already registered
    this.unregister(target.id);
    
    this.targets.push(target);
    // Sort by priority (highest first), then by type (UI before 3D)
    this.targets.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      // Same priority: UI before 3D
      if (a.type !== b.type) {
        return a.type === 'ui' ? -1 : 1;
      }
      return 0;
    });
  }
  
  /**
   * Unregister a raycast target
   */
  unregister(targetId: string): void {
    const index = this.targets.findIndex(t => t.id === targetId);
    if (index >= 0) {
      this.targets.splice(index, 1);
    }
  }
  
  /**
   * Perform raycast against all registered targets in priority order
   * Returns the first hit found (highest priority wins)
   */
  raycast(ray: THREE.Ray): RaycastHit | null {
    // Normalize ray direction for consistent results
    const normalizedRay = new THREE.Ray(
      ray.origin.clone(),
      ray.direction.clone().normalize()
    );
    
    // Check targets in priority order
    for (const target of this.targets) {
      // Skip inactive targets
      if (!target.isActive()) {
        continue;
      }
      
      // Perform raycast
      const hit = target.raycast(normalizedRay);
      if (hit) {
        // Ensure hit has target info
        hit.targetId = target.id;
        hit.type = target.type;
        this.lastHit = hit;
        return hit;
      }
    }
    
    // No hit found
    this.lastHit = null;
    return null;
  }
  
  /**
   * Get the last hit (useful for hover states)
   */
  getLastHit(): RaycastHit | null {
    return this.lastHit;
  }
  
  /**
   * Clear the last hit (call when interaction ends)
   */
  clearLastHit(): void {
    this.lastHit = null;
  }
  
  /**
   * Check if any UI target is currently active
   */
  hasActiveUI(): boolean {
    return this.targets.some(t => t.type === 'ui' && t.isActive());
  }
}

