/**
 * Environment flag for Gaussian Splat optimizations.
 * 
 * When VITE_GAUSSIAN_SPLAT_OPTIMIZED=1, Quest 3 optimizations are enabled:
 * - Optimized XR render loop
 * - Frustum culling and LOD for splats
 * - Foveated rendering
 * 
 * When unset or 0, legacy behavior is preserved.
 */
export const isGaussianSplatOptimizedEnabled =
  (import.meta as any).env?.VITE_GAUSSIAN_SPLAT_OPTIMIZED === '1';

