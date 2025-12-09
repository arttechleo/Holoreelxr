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
const rawFlag = (import.meta as any).env?.VITE_GAUSSIAN_SPLAT_OPTIMIZED ?? '0';

export const isGaussianSplatOptimizedEnabled: boolean = 
  rawFlag === '1' || rawFlag === 'true';

if ((import.meta as any).env?.PROD) {
  console.log('[GaussianEnv] VITE_GAUSSIAN_SPLAT_OPTIMIZED =', rawFlag, '→ enabled =', isGaussianSplatOptimizedEnabled);
}

