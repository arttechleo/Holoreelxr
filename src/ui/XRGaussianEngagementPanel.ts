// src/ui/XRGaussianEngagementPanel.ts
// Lightweight engagement panel for Gaussian Splat (.ply) viewing
// Uses simple geometry (not canvas) to avoid XR layer conflicts

import * as THREE from 'three';

export type EngagementAction = 'heart' | 'like' | 'repost';

export interface XRGaussianEngagementPanelCallbacks {
  onHeart?: () => void;
  onLike?: () => void;
  onRepost?: () => void;
}

/**
 * Lightweight engagement panel that appears when viewing .ply Gaussian splats.
 * 
 * DESIGN DECISION: Uses simple geometry with sprite/text materials, NOT canvas.
 * This prevents XR layer conflicts that cause phantom canvas artifacts.
 * 
 * The panel is positioned in front of the user at ~1.0-1.5m, slightly below eye level.
 * Three touchable/clickable areas: Heart (left), Like (middle), Repost (right).
 */
export class XRGaussianEngagementPanel {
  private group = new THREE.Group();
  private buttons: THREE.Mesh[] = [];
  private hoveredButton: EngagementAction | null = null;
  private isVisible = false;
  private parentAnchor: THREE.Group | null = null; // World-locked anchor (e.g., splat group)
  
  // Panel dimensions (in meters)
  private readonly PANEL_WIDTH = 0.4;
  private readonly PANEL_HEIGHT = 0.12;
  private readonly BUTTON_SIZE = 0.08;
  private readonly BUTTON_SPACING = 0.12;
  
  // World-locked offset relative to parent anchor
  private readonly WORLD_OFFSET = new THREE.Vector3(0, -0.3, 1.0); // 30cm down, 1m in front of splat
  
  // Callbacks
  private callbacks: XRGaussianEngagementPanelCallbacks = {};
  
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera
  ) {
    this.group.name = 'XRGaussianEngagementPanel';
    this.group.visible = false;
    // DON'T add to scene immediately - will be parented to splat anchor
    // this.scene.add(this.group);
    
    this.buildPanel();
  }
  
  /**
   * Attach panel to a world-locked anchor (e.g., splat group).
   * This makes the panel world-locked instead of head-tracked.
   */
  attachToAnchor(anchor: THREE.Group): void {
    // Remove from current parent
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    
    // Set position relative to anchor (world space offset)
    this.group.position.copy(this.WORLD_OFFSET);
    
    // Face user initially (one-time orientation)
    const cameraPos = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPos);
    this.group.lookAt(cameraPos);
    
    // Add to anchor
    anchor.add(this.group);
    this.parentAnchor = anchor;
  }
  
  /**
   * Detach panel from anchor (e.g., when splat is unloaded).
   */
  detachFromAnchor(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.parentAnchor = null;
    
    // Optionally add back to scene (hidden)
    // For now, leave it detached until re-attached
  }
  
  private buildPanel(): void {
    // Create background panel (semi-transparent dark background)
    const bgGeo = new THREE.PlaneGeometry(this.PANEL_WIDTH, this.PANEL_HEIGHT);
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.renderOrder = 10001; // High render order (above splats)
    bgMesh.name = 'engagement-panel-bg';
    this.group.add(bgMesh);
    
    // Create three button meshes with emoji sprites
    const buttonPositions: Array<{ action: EngagementAction; emoji: string; x: number }> = [
      { action: 'heart', emoji: '❤️', x: -this.BUTTON_SPACING },
      { action: 'like', emoji: '👍', x: 0 },
      { action: 'repost', emoji: '🔁', x: this.BUTTON_SPACING },
    ];
    
    buttonPositions.forEach(({ action, emoji, x }) => {
      const buttonGeo = new THREE.PlaneGeometry(this.BUTTON_SIZE, this.BUTTON_SIZE);
      
      // Create emoji texture from canvas (one-time, not updated per-frame)
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'transparent';
        ctx.fillRect(0, 0, 128, 128);
        ctx.font = '96px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, 64, 64);
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      
      const buttonMat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      
      const buttonMesh = new THREE.Mesh(buttonGeo, buttonMat);
      buttonMesh.position.set(x, 0, 0.001); // Slightly forward from background
      buttonMesh.renderOrder = 10002; // Above background
      buttonMesh.name = `engagement-button-${action}`;
      (buttonMesh as any).engagementAction = action; // Store action for hit testing
      
      this.buttons.push(buttonMesh);
      this.group.add(buttonMesh);
    });
  }
  
  /**
   * Set callbacks for button interactions.
   */
  setCallbacks(callbacks: XRGaussianEngagementPanelCallbacks): void {
    this.callbacks = callbacks;
  }
  
  /**
   * Show the panel in front of the user.
   */
  show(): void {
    this.isVisible = true;
    this.group.visible = true;
    this.updatePosition();
  }
  
  /**
   * Hide the panel.
   */
  hide(): void {
    this.isVisible = false;
    this.group.visible = false;
  }
  
  /**
   * Check if panel is visible.
   */
  isPanelVisible(): boolean {
    return this.isVisible && this.group.visible;
  }
  
  /**
   * Update panel to face camera (billboard effect while world-locked).
   * Called occasionally for billboard effect - panel stays world-locked to parent anchor.
   */
  update(camera: THREE.Camera): void {
    if (!this.isVisible || !this.parentAnchor) return;
    
    // World-locked billboard: face camera while staying at fixed world position
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);
    
    // Get panel's world position
    const panelWorldPos = new THREE.Vector3();
    this.group.getWorldPosition(panelWorldPos);
    
    // Make panel look at camera (billboard effect)
    this.group.lookAt(cameraPos);
  }
  
  /**
   * @deprecated - No longer used in world-locked mode
   */
  private updatePosition(): void {
    // Deprecated - panel is now world-locked to parent anchor
  }
  
  /**
   * Raycast against the panel buttons.
   * Returns the hit button action, or null if no hit.
   */
  raycast(raycaster: THREE.Raycaster): EngagementAction | null {
    if (!this.isVisible) return null;
    
    // Update raycaster to use world-space coordinates
    const intersects = raycaster.intersectObjects(this.buttons, false);
    if (intersects.length > 0) {
      const hit = intersects[0];
      const action = (hit.object as any).engagementAction as EngagementAction | undefined;
      if (action) {
        return action;
      }
    }
    
    return null;
  }
  
  /**
   * Get the panel's world position (for distance calculations).
   */
  getPosition(): THREE.Vector3 {
    return this.group.position.clone();
  }
  
  /**
   * Handle button click/interaction.
   */
  handleInteraction(action: EngagementAction): void {
    console.log(`[XRGaussianEngagementPanel] Button clicked: ${action}`);
    
    // Visual feedback: briefly scale up button
    const buttonMesh = this.buttons.find(
      (btn) => (btn as any).engagementAction === action
    );
    if (buttonMesh) {
      const originalScale = buttonMesh.scale.clone();
      buttonMesh.scale.multiplyScalar(1.2);
      setTimeout(() => {
        buttonMesh.scale.copy(originalScale);
      }, 150);
    }
    
    // Call callback
    switch (action) {
      case 'heart':
        this.callbacks.onHeart?.();
        break;
      case 'like':
        this.callbacks.onLike?.();
        break;
      case 'repost':
        this.callbacks.onRepost?.();
        break;
    }
  }
  
  /**
   * Set button hover state (for visual feedback).
   */
  setHoveredButton(action: EngagementAction | null): void {
    if (this.hoveredButton === action) return;
    
    // Reset previous hover
    if (this.hoveredButton !== null) {
      const prevButton = this.buttons.find(
        (btn) => (btn as any).engagementAction === this.hoveredButton
      );
      if (prevButton) {
        prevButton.scale.setScalar(1.0);
        (prevButton.material as THREE.MeshBasicMaterial).opacity = 1.0;
      }
    }
    
    this.hoveredButton = action;
    
    // Apply new hover
    if (action !== null) {
      const button = this.buttons.find(
        (btn) => (btn as any).engagementAction === action
      );
      if (button) {
        button.scale.setScalar(1.1);
        (button.material as THREE.MeshBasicMaterial).opacity = 0.9;
      }
    }
  }
  
  /**
   * Dispose resources.
   */
  dispose(): void {
    // Dispose textures
    this.buttons.forEach((button) => {
      const mat = button.material as THREE.MeshBasicMaterial;
      if (mat.map) {
        mat.map.dispose();
      }
      mat.dispose();
      button.geometry.dispose();
    });
    
    // Remove from scene
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    
    // Clear references
    this.buttons = [];
    this.group = new THREE.Group();
  }
}

