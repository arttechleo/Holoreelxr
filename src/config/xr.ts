/**
 * XR Configuration
 * Settings for VR/MR mode detection and feature support
 */

export const XR_CONFIG = {
  // Reference space types in order of preference
  REFERENCE_SPACES: ['local-floor', 'local', 'viewer'] as const,
  
  // Feature requirements
  REQUIRED_FEATURES: [] as string[],
  OPTIONAL_FEATURES: ['hand-tracking', 'layers'] as string[],
  
  // Session modes to try in order
  SESSION_MODES: ['immersive-ar', 'immersive-vr'] as const,
};

/**
 * Detect if we're in MR (passthrough) mode vs VR mode
 */
export function detectXRMode(session: XRSession | null): 'mr' | 'vr' | 'none' {
  if (!session) return 'none';
  
  // Try to detect passthrough/AR features
  if (session.environmentBlendMode === 'additive' || 
      session.environmentBlendMode === 'alpha-blend') {
    return 'mr';
  }
  
  return 'vr';
}

/**
 * Get optimal background for current XR mode
 */
export function getXRBackground(mode: 'mr' | 'vr' | 'none'): number | null {
  switch (mode) {
    case 'mr':
      return null; // Transparent for passthrough
    case 'vr':
      return 0x1a1a2e; // Dark blue for VR
    case 'none':
      return 0x87ceeb; // Sky blue for desktop
  }
}

