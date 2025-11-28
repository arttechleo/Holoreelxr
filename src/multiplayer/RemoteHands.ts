/**
 * RemoteHands - Visual representation of remote user's hands
 * Shows partner's hand positions and gestures in real-time
 */

import * as THREE from 'three';
import { HandState } from './MultiplayerManager';
import { HAND_BONE_CONNECTIONS, HAND_JOINT_NAMES } from '../gestures/HandEngine';

interface HandRenderGroup {
  root: THREE.Group;
  joints: THREE.Points;
  bones: THREE.LineSegments;
  glowBones: THREE.LineSegments; // Blue glow outline layer
  pinchIndicator: THREE.Mesh;
  jointPositions: Float32Array;
  bonePositions: Float32Array;
  jointGeometry: THREE.BufferGeometry;
  boneGeometry: THREE.BufferGeometry;
}

export class RemoteHands {
  private scene: THREE.Scene;
  private group = new THREE.Group();
  // Remote hands styling: Blue-glowing mesh hands to distinguish from local hands
  private readonly HAND_COLOR = 0x4a9eff; // Blue base color
  private readonly GLOW_COLOR = 0x6bb5ff; // Lighter blue for glow
  private readonly PINCH_COLOR = 0xffd93d; // Yellow for pinch indicator
  private readonly GLOW_INTENSITY = 2.0; // Emissive glow intensity

  private readonly leftHand: HandRenderGroup;
  private readonly rightHand: HandRenderGroup;
  
  // Player body representation (head + torso)
  private playerBody: THREE.Group;
  private headMesh: THREE.Mesh;
  private torsoMesh: THREE.Mesh;
  
  // Smoothing for stable position syncing
  private smoothedHeadPosition = new THREE.Vector3();
  private smoothedHeadRotation = new THREE.Quaternion();
  private readonly SMOOTH_FACTOR = 0.15; // Smoothing factor (0-1, lower = smoother)

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'RemoteHandsGroup';
    this.scene.add(this.group);

    this.leftHand = this.createHandGroup('left');
    this.rightHand = this.createHandGroup('right');
    
    // Create player body representation (head + torso)
    this.playerBody = this.createPlayerBody();
    this.group.add(this.playerBody);

    console.log('[RemoteHands] 👻 Remote hands visualization created');
  }
  
  private createPlayerBody(): THREE.Group {
    const bodyGroup = new THREE.Group();
    bodyGroup.name = 'remote-player-body';
    bodyGroup.visible = false;
    
    // Head - simple sphere
    const headGeometry = new THREE.SphereGeometry(0.12, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: this.HAND_COLOR,
      emissive: this.GLOW_COLOR,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.9,
    });
    this.headMesh = new THREE.Mesh(headGeometry, headMaterial);
    this.headMesh.position.set(0, 1.6, 0); // Head at ~1.6m height
    bodyGroup.add(this.headMesh);
    
    // Torso - capsule/cylinder
    const torsoGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.6, 16);
    const torsoMaterial = new THREE.MeshStandardMaterial({
      color: this.HAND_COLOR,
      emissive: this.GLOW_COLOR,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.85,
    });
    this.torsoMesh = new THREE.Mesh(torsoGeometry, torsoMaterial);
    this.torsoMesh.position.set(0, 1.3, 0); // Torso center at ~1.3m height
    bodyGroup.add(this.torsoMesh);
    
    return bodyGroup;
  }

  private createHandGroup(side: 'left' | 'right'): HandRenderGroup {
    const root = new THREE.Group();
    root.visible = false;
    root.name = `${side}-remote-hand`;
    this.group.add(root);

    // Create mesh hand representation with blue glow
    // Use spheres for joints (mesh-like appearance)
    const jointPositions = new Float32Array(HAND_JOINT_NAMES.length * 3);
    const jointGeometry = new THREE.BufferGeometry();
    jointGeometry.setAttribute('position', new THREE.BufferAttribute(jointPositions, 3));
    
    // Blue-glowing joint material
    const jointMaterial = new THREE.PointsMaterial({
      color: this.HAND_COLOR, // Blue base color
      size: 0.018, // Larger size for mesh-like appearance
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const joints = new THREE.Points(jointGeometry, jointMaterial);
    root.add(joints);

    // Create bone mesh representation with blue glow
    const bonePositions = new Float32Array(HAND_BONE_CONNECTIONS.length * 6);
    const boneGeometry = new THREE.BufferGeometry();
    boneGeometry.setAttribute('position', new THREE.BufferAttribute(bonePositions, 3));
    
    // Blue-glowing bone material with emissive glow
    const boneMaterial = new THREE.LineBasicMaterial({
      color: this.HAND_COLOR, // Blue base color
      transparent: true,
      opacity: 0.9,
      linewidth: 4, // Thicker lines for mesh-like appearance
      depthWrite: false,
    });
    const bones = new THREE.LineSegments(boneGeometry, boneMaterial);
    root.add(bones);
    
    // Add blue glow effect using emissive outline
    // Create additional outline layer for glow effect
    const glowGeometry = new THREE.BufferGeometry();
    glowGeometry.setAttribute('position', new THREE.BufferAttribute(bonePositions.slice(), 3));
    const glowMaterial = new THREE.LineBasicMaterial({
      color: this.GLOW_COLOR, // Lighter blue for glow
      transparent: true,
      opacity: 0.4, // Subtle glow
      linewidth: 6, // Thicker for glow effect
      depthWrite: false,
    });
    const glowBones = new THREE.LineSegments(glowGeometry, glowMaterial);
    glowBones.renderOrder = -1; // Render behind main bones
    root.add(glowBones);

    const pinchIndicator = new THREE.Mesh(
      new THREE.RingGeometry(0.015, 0.03, 24),
      new THREE.MeshBasicMaterial({
        color: this.PINCH_COLOR,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    pinchIndicator.visible = false;
    pinchIndicator.renderOrder = 9999;
    root.add(pinchIndicator);

    return {
      root,
      joints,
      bones,
      glowBones, // Blue glow outline layer
      pinchIndicator,
      jointPositions,
      bonePositions,
      jointGeometry,
      boneGeometry,
    };
  }

  update(hands: HandState | null | undefined, localCamera?: THREE.Camera): void {
    if (!hands) {
      // ENHANCED: Keep group visible even if no hand data (might be temporary)
      // Only hide if explicitly set via setVisible(false)
      return;
    }
    
    // Update player body position (mirrored in front of local player)
    this.updatePlayerBody(hands, localCamera);
    
    const leftVisible = this.updateHand(hands.left, this.leftHand);
    const rightVisible = this.updateHand(hands.right, this.rightHand);
    const anyVisible = leftVisible || rightVisible;
    // ENHANCED: Show group if any hand is visible, but don't hide if explicitly set to visible
    // CRITICAL: Always show group when connected (even if no hand data yet) to match single-user behavior
    if (anyVisible || this.group.visible || (hands.headPosition && this.playerBody.visible)) {
      this.group.visible = true;
    }

    // Update blue glow colors
    if (hands.gestures?.heart) {
      // Pink for heart gesture
      (this.leftHand.bones.material as THREE.LineBasicMaterial).color.set(0xff73ff);
      (this.rightHand.bones.material as THREE.LineBasicMaterial).color.set(0xff73ff);
      (this.leftHand.glowBones.material as THREE.LineBasicMaterial).color.set(0xff9aff);
      (this.rightHand.glowBones.material as THREE.LineBasicMaterial).color.set(0xff9aff);
    } else {
      // Blue glow for normal state
      (this.leftHand.bones.material as THREE.LineBasicMaterial).color.set(this.HAND_COLOR);
      (this.rightHand.bones.material as THREE.LineBasicMaterial).color.set(this.HAND_COLOR);
      (this.leftHand.glowBones.material as THREE.LineBasicMaterial).color.set(this.GLOW_COLOR);
      (this.rightHand.glowBones.material as THREE.LineBasicMaterial).color.set(this.GLOW_COLOR);
    }
  }

  private updateHand(data: HandState['left'], renderGroup: HandRenderGroup): boolean {
    if (!data || !data.joints) {
      renderGroup.root.visible = false;
      return false;
    }

    let hasSample = false;
    HAND_JOINT_NAMES.forEach((name, idx) => {
      const sample = data.joints?.[name];
      const offset = idx * 3;
      if (sample) {
        renderGroup.jointPositions[offset] = sample.x;
        renderGroup.jointPositions[offset + 1] = sample.y;
        renderGroup.jointPositions[offset + 2] = sample.z;
        hasSample = true;
      } else {
        renderGroup.jointPositions[offset] =
          renderGroup.jointPositions[offset + 1] =
          renderGroup.jointPositions[offset + 2] =
            0;
      }
    });

    if (!hasSample) {
      renderGroup.root.visible = false;
      return false;
    }

    renderGroup.jointGeometry.attributes.position.needsUpdate = true;

    HAND_BONE_CONNECTIONS.forEach(([from, to], boneIndex) => {
      const fromSample = data.joints?.[from];
      const toSample = data.joints?.[to];
      const offset = boneIndex * 6;
      if (fromSample && toSample) {
        renderGroup.bonePositions[offset] = fromSample.x;
        renderGroup.bonePositions[offset + 1] = fromSample.y;
        renderGroup.bonePositions[offset + 2] = fromSample.z;
        renderGroup.bonePositions[offset + 3] = toSample.x;
        renderGroup.bonePositions[offset + 4] = toSample.y;
        renderGroup.bonePositions[offset + 5] = toSample.z;
      } else {
        renderGroup.bonePositions.fill(0, offset, offset + 6);
      }
    });

    renderGroup.boneGeometry.attributes.position.needsUpdate = true;
    
    // Update glow bones geometry to match main bones (for blue glow effect)
    const glowPositions = renderGroup.glowBones.geometry.attributes.position as THREE.BufferAttribute;
    glowPositions.array.set(renderGroup.bonePositions);
    glowPositions.needsUpdate = true;
    
    renderGroup.root.visible = true;

    // Update pinch indicator with pinch mid (position) if available
    if (data.position && data.pinching) {
      renderGroup.pinchIndicator.visible = true;
      renderGroup.pinchIndicator.position.set(
        data.position.x,
        data.position.y,
        data.position.z
      );
    } else {
      renderGroup.pinchIndicator.visible = false;
    }

    const jointMaterial = renderGroup.joints.material as THREE.PointsMaterial;
    jointMaterial.opacity = data.open ? 1.0 : 0.75;

    const boneMaterial = renderGroup.bones.material as THREE.LineBasicMaterial;
    boneMaterial.opacity = data.pinching ? 1.0 : 0.6;

    return true;
  }
  
  /**
   * Update player body position - mirrored in front of local player
   * Positions remote player directly across from local player
   */
  private updatePlayerBody(hands: HandState, localCamera?: THREE.Camera): void {
    if (!localCamera || !hands.headPosition) {
      this.playerBody.visible = false;
      return;
    }
    
    // Get local camera position and forward direction
    const localCamPos = new THREE.Vector3();
    const localCamDir = new THREE.Vector3();
    localCamera.getWorldPosition(localCamPos);
    localCamera.getWorldDirection(localCamDir);
    
    // Position remote player in front of local player (mirrored spatial relationship)
    // Distance: ~1.5m in front (comfortable conversation distance)
    const PLAYER_DISTANCE = 1.5;
    const targetHeadPos = localCamPos.clone().add(localCamDir.multiplyScalar(PLAYER_DISTANCE));
    
    // Apply smoothing for stable position syncing (prevents jitter/flicker)
    this.smoothedHeadPosition.lerp(targetHeadPos, this.SMOOTH_FACTOR);
    
    // Update head rotation if available (smoothed)
    // Mirror the rotation so remote player faces local player
    if (hands.headRotation) {
      const remoteHeadRot = new THREE.Quaternion(
        hands.headRotation.x,
        hands.headRotation.y,
        hands.headRotation.z,
        hands.headRotation.w
      );
      // Mirror rotation on Y axis (flip horizontally)
      remoteHeadRot.y *= -1;
      remoteHeadRot.w *= -1;
      this.smoothedHeadRotation.slerp(remoteHeadRot, this.SMOOTH_FACTOR);
      this.headMesh.quaternion.copy(this.smoothedHeadRotation);
    } else {
      // Face local player if no rotation data
      this.headMesh.lookAt(localCamPos);
    }
    
    // Position body group at smoothed head position (body is at head position, head mesh is offset)
    this.playerBody.position.copy(this.smoothedHeadPosition);
    // Head mesh is already positioned at (0, 1.6, 0) relative to body, so body should be at head position - head offset
    this.playerBody.position.y -= 1.6; // Adjust for head mesh offset
    
    // Make body visible
    this.playerBody.visible = true;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    [this.leftHand, this.rightHand].forEach((hand) => {
      hand.jointGeometry.dispose();
      (hand.joints.material as THREE.Material).dispose();
      hand.boneGeometry.dispose();
      (hand.bones.material as THREE.Material).dispose();
      hand.glowBones.geometry.dispose();
      (hand.glowBones.material as THREE.Material).dispose();
      hand.pinchIndicator.geometry.dispose();
      (hand.pinchIndicator.material as THREE.Material).dispose();
    });
    
    // Dispose player body
    this.headMesh.geometry.dispose();
    (this.headMesh.material as THREE.Material).dispose();
    this.torsoMesh.geometry.dispose();
    (this.torsoMesh.material as THREE.Material).dispose();
    
    this.scene.remove(this.group);
  }
}

