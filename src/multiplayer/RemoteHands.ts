/**
 * RemoteHands - Visual representation of remote user's hands
 * Shows partner's hand positions and gestures in real-time
 */

import * as THREE from 'three';
import { HandState } from './MultiplayerManager';

export class RemoteHands {
  private scene: THREE.Scene;
  private leftHandMesh: THREE.Mesh | null = null;
  private rightHandMesh: THREE.Mesh | null = null;
  private leftPinchIndicator: THREE.Mesh | null = null;
  private rightPinchIndicator: THREE.Mesh | null = null;
  private group = new THREE.Group();
  
  // Ghost-like appearance for remote hands
  private readonly HAND_COLOR = 0x4ECDC4; // Cyan
  private readonly PINCH_COLOR = 0xFFD93D; // Yellow
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'RemoteHandsGroup';
    this.scene.add(this.group);
    
    this.createHandMeshes();
    console.log('[RemoteHands] 👻 Remote hands visualization created');
  }
  
  /**
   * Create visual meshes for hands
   */
  private createHandMeshes(): void {
    // Left hand
    const leftGeom = new THREE.SphereGeometry(0.03, 16, 16);
    const leftMat = new THREE.MeshBasicMaterial({
      color: this.HAND_COLOR,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    this.leftHandMesh = new THREE.Mesh(leftGeom, leftMat);
    this.leftHandMesh.visible = false;
    this.group.add(this.leftHandMesh);
    
    // Left pinch indicator
    const leftPinchGeom = new THREE.RingGeometry(0.02, 0.04, 16);
    const leftPinchMat = new THREE.MeshBasicMaterial({
      color: this.PINCH_COLOR,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.leftPinchIndicator = new THREE.Mesh(leftPinchGeom, leftPinchMat);
    this.leftPinchIndicator.visible = false;
    this.group.add(this.leftPinchIndicator);
    
    // Right hand
    const rightGeom = new THREE.SphereGeometry(0.03, 16, 16);
    const rightMat = new THREE.MeshBasicMaterial({
      color: this.HAND_COLOR,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    this.rightHandMesh = new THREE.Mesh(rightGeom, rightMat);
    this.rightHandMesh.visible = false;
    this.group.add(this.rightHandMesh);
    
    // Right pinch indicator
    const rightPinchGeom = new THREE.RingGeometry(0.02, 0.04, 16);
    const rightPinchMat = new THREE.MeshBasicMaterial({
      color: this.PINCH_COLOR,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    this.rightPinchIndicator = new THREE.Mesh(rightPinchGeom, rightPinchMat);
    this.rightPinchIndicator.visible = false;
    this.group.add(this.rightPinchIndicator);
  }
  
  /**
   * Update remote hand positions
   * CRITICAL FIX: Validate incoming data to prevent null reference errors
   */
  update(hands: HandState | null | undefined): void {
    // CRITICAL: Validate hands data
    if (!hands || typeof hands !== 'object') {
      return;
    }
    
    // Update left hand
    if (hands.left && hands.left.position && this.leftHandMesh) {
      this.leftHandMesh.position.set(
        hands.left.position.x,
        hands.left.position.y,
        hands.left.position.z
      );
      
      if (hands.left.rotation) {
        this.leftHandMesh.quaternion.set(
          hands.left.rotation.x,
          hands.left.rotation.y,
          hands.left.rotation.z,
          hands.left.rotation.w
        );
      }
      
      this.leftHandMesh.visible = true;
      
      // Show pinch indicator
      if (this.leftPinchIndicator) {
        this.leftPinchIndicator.position.copy(this.leftHandMesh.position);
        this.leftPinchIndicator.visible = hands.left.pinching;
        
        // Face camera
        if (hands.left.pinching) {
          this.leftPinchIndicator.lookAt(0, hands.left.position.y, 0);
        }
      }
    } else if (this.leftHandMesh) {
      this.leftHandMesh.visible = false;
      if (this.leftPinchIndicator) {
        this.leftPinchIndicator.visible = false;
      }
    }
    
    // Update right hand
    if (hands.right && hands.right.position && this.rightHandMesh) {
      this.rightHandMesh.position.set(
        hands.right.position.x,
        hands.right.position.y,
        hands.right.position.z
      );
      
      if (hands.right.rotation) {
        this.rightHandMesh.quaternion.set(
          hands.right.rotation.x,
          hands.right.rotation.y,
          hands.right.rotation.z,
          hands.right.rotation.w
        );
      }
      
      this.rightHandMesh.visible = true;
      
      // Show pinch indicator
      if (this.rightPinchIndicator) {
        this.rightPinchIndicator.position.copy(this.rightHandMesh.position);
        this.rightPinchIndicator.visible = hands.right.pinching;
        
        // Face camera
        if (hands.right.pinching) {
          this.rightPinchIndicator.lookAt(0, hands.right.position.y, 0);
        }
      }
    } else if (this.rightHandMesh) {
      this.rightHandMesh.visible = false;
      if (this.rightPinchIndicator) {
        this.rightPinchIndicator.visible = false;
      }
    }
  }
  
  /**
   * Show/hide remote hands
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
  
  /**
   * Cleanup
   */
  dispose(): void {
    if (this.leftHandMesh) {
      this.leftHandMesh.geometry.dispose();
      (this.leftHandMesh.material as THREE.Material).dispose();
    }
    if (this.rightHandMesh) {
      this.rightHandMesh.geometry.dispose();
      (this.rightHandMesh.material as THREE.Material).dispose();
    }
    if (this.leftPinchIndicator) {
      this.leftPinchIndicator.geometry.dispose();
      (this.leftPinchIndicator.material as THREE.Material).dispose();
    }
    if (this.rightPinchIndicator) {
      this.rightPinchIndicator.geometry.dispose();
      (this.rightPinchIndicator.material as THREE.Material).dispose();
    }
    
    this.scene.remove(this.group);
    console.log('[RemoteHands] Disposed');
  }
}

