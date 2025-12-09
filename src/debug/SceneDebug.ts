// src/debug/SceneDebug.ts
// Debug utility to identify phantom canvas/UI meshes causing see-through artifacts

import * as THREE from 'three';

const DEBUG_GS_SCENE = false; // Set to true to enable debug logging

interface SuspectMesh {
  name: string;
  type: string;
  material: string;
  hasCanvasTexture: boolean;
  hasVideoTexture: boolean;
  isTransparent: boolean;
  position: { x: number; y: number; z: number };
  visible: boolean;
  parent: string;
  path: string[];
}

/**
 * Debug helper to identify meshes that might cause phantom passthrough artifacts.
 * 
 * When DEBUG_GS_SCENE is true and a Gaussian splat is active, this will:
 * - Traverse the scene and find all suspect meshes
 * - Log detailed information about each suspect
 * - Optionally highlight them with debug colors
 */
export function debugGaussianSplatScene(
  scene: THREE.Scene,
  highlight: boolean = false
): SuspectMesh[] {
  if (!isDebugEnabled()) return [];
  
  const suspects: SuspectMesh[] = [];
  
  scene.traverse((object: THREE.Object3D) => {
    // Skip the splat meshes themselves
    if (isSplatMesh(object)) {
      return;
    }
    
    // Check if this is a mesh with materials
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    
    const materials = Array.isArray(mesh.material) 
      ? mesh.material 
      : [mesh.material];
    
    let isSuspect = false;
    let hasCanvasTexture = false;
    let hasVideoTexture = false;
    let isTransparent = false;
    const materialTypes: string[] = [];
    
    materials.forEach((mat) => {
      if (!mat) return;
      
      materialTypes.push(mat.type || 'unknown');
      
      // Check for transparency
      if ((mat as any).transparent === true) {
        isTransparent = true;
        isSuspect = true;
      }
      
      // Check for canvas texture
      if ((mat as any).map) {
        const map = (mat as any).map;
        if (map && map.isCanvasTexture) {
          hasCanvasTexture = true;
          isSuspect = true;
        }
        if (map && map.isVideoTexture) {
          hasVideoTexture = true;
          isSuspect = true;
        }
      }
      
      // Check for suspicious names
      const objectName = (object.name || '').toLowerCase();
      const matName = ((mat as any).name || '').toLowerCase();
      const suspiciousKeywords = ['panel', 'ui', 'canvas', 'quad', 'hud', 'tutorial', 'keypad', 'keyboard'];
      
      if (suspiciousKeywords.some(kw => objectName.includes(kw) || matName.includes(kw))) {
        isSuspect = true;
      }
    });
    
    if (isSuspect) {
      const path: string[] = [];
      let current: THREE.Object3D | null = object;
      while (current && current !== scene) {
        path.unshift(current.name || current.type || 'unnamed');
        current = current.parent;
      }
      path.unshift('scene');
      
      suspects.push({
        name: object.name || 'unnamed',
        type: object.type,
        material: materialTypes.join(', '),
        hasCanvasTexture,
        hasVideoTexture,
        isTransparent,
        position: {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z
        },
        visible: object.visible,
        parent: object.parent?.name || 'none',
        path
      });
      
      // Optionally highlight suspect meshes
      if (highlight && mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat: any) => {
          // Store original color if not already stored
          if (!mat.userData._originalColor) {
            mat.userData._originalColor = mat.color?.clone();
            mat.userData._originalEmissive = mat.emissive?.clone();
          }
          
          // Apply debug highlight (bright red emissive)
          mat.color = new THREE.Color(0xff0000);
          mat.emissive = new THREE.Color(0x330000);
          mat.emissiveIntensity = 2.0;
        });
      }
    }
  });
  
  if (suspects.length > 0) {
    console.group('[SceneDebug] 🔍 Suspect meshes found (potential phantom panels):');
    suspects.forEach((suspect, i) => {
      console.log(`[${i + 1}] ${suspect.name} (${suspect.type})`, {
        material: suspect.material,
        hasCanvasTexture: suspect.hasCanvasTexture ? '⚠️ YES' : 'no',
        hasVideoTexture: suspect.hasVideoTexture ? '⚠️ YES' : 'no',
        isTransparent: suspect.isTransparent ? '⚠️ YES' : 'no',
        visible: suspect.visible,
        position: suspect.position,
        path: suspect.path.join(' -> ')
      });
    });
    console.groupEnd();
  } else {
    console.log('[SceneDebug] ✅ No suspect meshes found');
  }
  
  return suspects;
}

/**
 * Check if an object is a Gaussian splat mesh (should not be flagged as suspect).
 */
function isSplatMesh(object: THREE.Object3D): boolean {
  // Check for SplatMesh indicators
  if ((object as any).constructor?.name === 'SplatMesh') return true;
  if ((object as any).isSplatMesh === true) return true;
  if ((object as any).url && (object as any).initialized !== undefined) return true;
  if (object.type === 'SplatMesh') return true;
  
  // Check parent/ancestor for splat indicators
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.name && (
      current.name.includes('gaussian') ||
      current.name.includes('splat') ||
      current.name === 'gaussian-splat'
    )) {
      return true;
    }
    current = current.parent;
  }
  
  return false;
}

/**
 * Restore original colors after debugging (call this when done debugging).
 */
export function restoreDebugHighlights(scene: THREE.Scene): void {
  scene.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((mat: any) => {
      if (mat.userData._originalColor) {
        mat.color = mat.userData._originalColor;
        delete mat.userData._originalColor;
      }
      if (mat.userData._originalEmissive) {
        mat.emissive = mat.userData._originalEmissive;
        mat.emissiveIntensity = 0;
        delete mat.userData._originalEmissive;
      }
    });
  });
}

