/**
 * Background blur effect for when keyboard is active
 * Blurs the 3D content while keeping keyboard sharp
 */

import * as THREE from 'three';

export class BackgroundBlur {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private blurAmount = 0; // 0 = no blur, 1 = full blur
  private targetBlur = 0;
  private contentGroup: THREE.Group;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, contentGroup: THREE.Group) {
    this.scene = scene;
    this.renderer = renderer;
    this.contentGroup = contentGroup;
  }

  /**
   * Enable blur effect
   */
  enable() {
    this.targetBlur = 1.0;
  }

  /**
   * Disable blur effect
   */
  disable() {
    this.targetBlur = 0;
  }

  /**
   * Update blur amount (smooth transition)
   */
  tick(dt: number) {
    // Smooth transition
    const blurSpeed = 5.0;
    this.blurAmount += (this.targetBlur - this.blurAmount) * blurSpeed * dt;

    if (this.blurAmount > 0.01) {
      // Apply depth fade to content
      this.contentGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => {
              if ('opacity' in m) {
                (m as any).transparent = true;
                (m as any).opacity = 1.0 - (this.blurAmount * 0.5); // 50% max fade
              }
            });
          } else {
            if ('opacity' in mat) {
              (mat as any).transparent = true;
              (mat as any).opacity = 1.0 - (this.blurAmount * 0.5);
            }
          }
        }
      });
    } else {
      // Restore full opacity
      this.contentGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => {
              if ('opacity' in m && (m as any).opacity < 1.0) {
                (m as any).opacity = 1.0;
              }
            });
          } else {
            if ('opacity' in mat && (mat as any).opacity < 1.0) {
              (mat as any).opacity = 1.0;
            }
          }
        }
      });
    }
  }

  /**
   * Get current blur amount
   */
  getBlurAmount(): number {
    return this.blurAmount;
  }
}

