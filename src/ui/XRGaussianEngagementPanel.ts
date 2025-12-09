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
  
  // Panel dimensions (in meters)
  private readonly PANEL_WIDTH = 0.4;
  private readonly PANEL_HEIGHT = 0.12;
  private readonly BUTTON_SIZE = 0.08;
  private readonly BUTTON_SPACING = 0.12;
  
  // Callbacks
  private callbacks: XRGaussianEngagementPanelCallbacks = {};
  
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera
  ) {
    this.group.name = 'XRGaussianEngagementPanel';
    this.group.visible = false;
    this.scene.add(this.group);
    
    this.buildPanel();
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
   * Update panel position to face camera.
   * Called every frame when visible.
   */
  update(camera: THREE.Camera): void {
    if (!this.isVisible) return;
    this.camera = camera;
    this.updatePosition();
  }
  
  private updatePosition(): void {
    if (!this.camera) return;
    
    // Position in front of camera at ~1.2m distance, 0.3m below eye level
    const cameraPos = new THREE.Vector3();
    const cameraDir = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPos);
    this.camera.getWorldDirection(cameraDir);
    
    const distance = 1.2; // meters in front of user
    const offsetDown = new THREE.Vector3(0, -0.3, 0); // Below eye level
    
    const targetPos = cameraPos
      .clone()
      .add(cameraDir.multiplyScalar(distance))
      .add(offsetDown);
    
    this.group.position.copy(targetPos);
    
    // Make panel face camera
    this.group.lookAt(cameraPos);
    // Rotate 180° around Y to face correct direction
    this.group.rotateY(Math.PI);
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

