// src/feed/loaders/GaussianSplatBackend.optimized.ts
/**
 * Optimized Gaussian Splat backend for Quest 3 WebXR performance.
 * 
 * This module provides optimized backends that add:
 * - Cached bounding volumes (Box3 + Sphere)
 * - Frustum culling + disabled matrix auto-updates on static splat children
 * - Per-splat onBeforeRender handler for distance-based LOD (opacity only)
 * 
 * All optimizations are gated behind isGaussianSplatOptimizedEnabled flag.
 */

import * as THREE from 'three';
import { isGaussianSplatOptimizedEnabled } from '../../config/gaussianEnv';
import { createLegacyBackendInternal } from './GaussianSplatBackend';
import type { IGaussianSplatBackend, GaussianSplatAsset } from './GaussianSplatBackend';

export const QUEST3_OPTIMIZATION = {
  LOD: {
    NEAR: 2.0,
    MEDIUM: 5.0,
    FAR: 10.0,
    OPACITY_NEAR: 1.0,
    OPACITY_MEDIUM: 0.9,
    OPACITY_FAR: 0.8,
    OPACITY_VERY_FAR: 0.7,
    FRAMES_PER_UPDATE: 10,
  },
} as const;

type LODMeta = {
  boundingSphere: THREE.Sphere;
  lastOpacity: number;
  frameCounter: number;
};

/**
 * Update LOD for a splat object based on camera distance.
 * Called from onBeforeRender handler.
 */
export function updateSplatLOD(
  root: THREE.Object3D,
  camera: THREE.Camera,
  meta: LODMeta
): void {
  meta.frameCounter++;
  if (meta.frameCounter < QUEST3_OPTIMIZATION.LOD.FRAMES_PER_UPDATE) return;
  meta.frameCounter = 0;

  const distance = camera.position.distanceTo(meta.boundingSphere.center);

  let targetOpacity: number;
  if (distance < QUEST3_OPTIMIZATION.LOD.NEAR) {
    targetOpacity = QUEST3_OPTIMIZATION.LOD.OPACITY_NEAR;
  } else if (distance < QUEST3_OPTIMIZATION.LOD.MEDIUM) {
    targetOpacity = QUEST3_OPTIMIZATION.LOD.OPACITY_MEDIUM;
  } else if (distance < QUEST3_OPTIMIZATION.LOD.FAR) {
    targetOpacity = QUEST3_OPTIMIZATION.LOD.OPACITY_FAR;
  } else {
    targetOpacity = QUEST3_OPTIMIZATION.LOD.OPACITY_VERY_FAR;
  }

  if (Math.abs(targetOpacity - meta.lastOpacity) < 0.01) return;
  meta.lastOpacity = targetOpacity;

  root.traverse((obj) => {
    const mat = (obj as any).material;
    if (!mat) return;

    if (Array.isArray(mat)) {
      for (const m of mat) {
        m.opacity = targetOpacity;
        m.transparent = targetOpacity < 1.0;
        m.needsUpdate = true;
      }
    } else {
      mat.opacity = targetOpacity;
      mat.transparent = targetOpacity < 1.0;
      mat.needsUpdate = true;
    }
  });
}

function attachBoundsAndLOD(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  const meta: LODMeta = {
    boundingSphere: sphere,
    lastOpacity: 1.0,
    frameCounter: 0,
  };

  (root as any).__splatLOD = meta;

  // Enable frustum culling + freeze transforms for children
  root.traverse((obj) => {
    if ((obj as any).isMesh || (obj as any).isPoints) {
      obj.frustumCulled = true;
      obj.matrixAutoUpdate = false;
      obj.updateMatrix();
    }
  });

  // Lightweight, per-splat LOD: does NOT depend on any new render loop
  root.onBeforeRender = (
    _renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    camera: THREE.Camera,
  ) => {
    updateSplatLOD(root, camera, meta);
  };
}

/**
 * Optimized Spark backend wrapper.
 */
class OptimizedSparkBackend implements IGaussianSplatBackend {
  private legacy: IGaussianSplatBackend;

  constructor() {
    this.legacy = createLegacyBackendInternal();
  }

  getName(): string {
    return `optimized-${this.legacy.getName()}`;
  }

  async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    const asset = await this.legacy.loadSplat(url, settingsUrl);

    if (!isGaussianSplatOptimizedEnabled || !asset?.scene) {
      return asset;
    }

    attachBoundsAndLOD(asset.scene);
    return asset;
  }

  async preloadSplat(url: string, settingsUrl?: string): Promise<void> {
    return this.legacy.preloadSplat(url, settingsUrl);
  }

  dispose(): void {
    this.legacy.dispose();
  }
}

/**
 * Optimized GaussianSplats3D backend wrapper.
 */
class OptimizedGaussianSplats3DBackend implements IGaussianSplatBackend {
  private legacy: IGaussianSplatBackend;

  constructor() {
    this.legacy = createLegacyBackendInternal();
  }

  getName(): string {
    return `optimized-${this.legacy.getName()}`;
  }

  async loadSplat(url: string, settingsUrl?: string): Promise<GaussianSplatAsset> {
    const asset = await this.legacy.loadSplat(url, settingsUrl);

    if (!isGaussianSplatOptimizedEnabled || !asset?.scene) {
      return asset;
    }

    attachBoundsAndLOD(asset.scene);
    return asset;
  }

  async preloadSplat(url: string, settingsUrl?: string): Promise<void> {
    return this.legacy.preloadSplat(url, settingsUrl);
  }

  dispose(): void {
    this.legacy.dispose();
  }
}

/**
 * Create an optimized Gaussian Splat backend instance.
 * Returns optimized wrapper when flag is enabled, otherwise legacy backend.
 */
export function createGaussianSplatBackend(): IGaussianSplatBackend {
  if (!isGaussianSplatOptimizedEnabled) {
    return createLegacyBackendInternal();
  }

  const legacy = createLegacyBackendInternal();
  const backendName = legacy.getName();

  if (backendName === 'spark') {
    return new OptimizedSparkBackend();
  } else if (backendName === 'gaussian-splats-3d') {
    return new OptimizedGaussianSplats3DBackend();
  } else {
    // Fallback to optimized wrapper
    return new OptimizedSparkBackend();
  }
}

// Re-export types for convenience
export type { IGaussianSplatBackend, GaussianSplatAsset };
