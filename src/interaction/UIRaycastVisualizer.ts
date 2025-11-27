/**
 * UIRaycastVisualizer - Unified visual raycast line system for UI panels
 * 
 * Provides consistent visual feedback when pointing at UI elements:
 * - Shows ray line from hand/fingertip to UI hit point
 * - Updates in real-time
 * - Disappears when no UI target is hit
 * - Works for all UI panels (tutorial, multiplayer, keypad, HUD)
 */

import * as THREE from 'three';

export interface UIRaycastHit {
  /** Hit point in world space */
  point: THREE.Vector3;
  
  /** Distance from ray origin to hit point */
  distance: number;
  
  /** UI panel identifier */
  panelId: string;
}

export class UIRaycastVisualizer {
  private rayLine: THREE.Line | null = null;
  private rayMaterial: THREE.LineBasicMaterial;
  private scene: THREE.Scene;
  private currentHit: UIRaycastHit | null = null;
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    
    // Create ray material (cyan for UI, distinct from 3D rays)
    this.rayMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff, // Cyan
      opacity: 0.8,
      transparent: true,
      linewidth: 2
    });
  }
  
  /**
   * Update raycast line visualization
   * @param rayOrigin - Hand/fingertip position
   * @param hit - UI hit result (null to hide)
   */
  update(rayOrigin: THREE.Vector3, hit: UIRaycastHit | null): void {
    if (hit) {
      // Show ray line to UI hit point
      this.currentHit = hit;
      this.showRay(rayOrigin, hit.point);
    } else {
      // Hide ray line
      this.currentHit = null;
      this.hideRay();
    }
  }
  
  /**
   * Show ray line from origin to target
   */
  private showRay(origin: THREE.Vector3, target: THREE.Vector3): void {
    // Remove old line if exists
    this.hideRay();
    
    // Create new line geometry
    const points = [origin.clone(), target.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    // Create line
    this.rayLine = new THREE.Line(geometry, this.rayMaterial);
    this.rayLine.renderOrder = 10000; // Render on top
    this.scene.add(this.rayLine);
  }
  
  /**
   * Hide ray line
   */
  private hideRay(): void {
    if (this.rayLine) {
      this.scene.remove(this.rayLine);
      this.rayLine.geometry.dispose();
      this.rayLine = null;
    }
  }
  
  /**
   * Get current hit (for debugging)
   */
  getCurrentHit(): UIRaycastHit | null {
    return this.currentHit;
  }
  
  /**
   * Cleanup
   */
  dispose(): void {
    this.hideRay();
    this.rayMaterial.dispose();
  }
}

