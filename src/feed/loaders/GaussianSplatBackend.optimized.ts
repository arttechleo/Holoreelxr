// src/feed/loaders/GaussianSplatBackend.optimized.ts
/**
 * Optimized Gaussian Splat backend for Quest 3 WebXR performance.
 * 
 * This module provides optimized backends that add:
 * - Cached bounding volumes (Box3 + Sphere)
 * - Frustum culling + disabled matrix auto-updates on static splat children
 * 
 * NOTE: Dynamic opacity LOD is disabled to prevent stereo flicker in WebXR.
 * Per-eye opacity changes cause right-eye blinking artifacts.
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
 * 
 * TEMP: Disabled to prevent stereo flicker in WebXR.
 * Per-eye opacity changes cause right-eye blinking artifacts.
 * We keep the function signature for future use but make it a no-op.
 * 
 * Safe optimizations still active:
 * - Cached bounding volumes
 * - Frustum culling on splat children
 * - matrixAutoUpdate=false on static splats
 */
export function updateSplatLOD(
  root: THREE.Object3D,
  camera: THREE.Camera,
  meta: LODMeta
): void {
  // TEMP: Disable dynamic opacity LOD to prevent stereo flicker
  // and reduce per-frame overhead. We still keep cached bounds
  // + frustum culling from attachBoundsAndLOD.
  return;
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
