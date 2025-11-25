/**
 * XRMultiplayerPanel - Canvas-based UI (like tutorial)
 * RELIABLE text rendering in VR using 2D canvas
 */

import * as THREE from 'three';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager';

type ButtonType = 'host' | 'join' | 'close';

export class XRMultiplayerPanel {
  private group = new THREE.Group();
  private panel: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private multiplayer: MultiplayerManager;
  private visible = false;
  
  // State
  private currentCode = '';
  private mode: 'idle' | 'hosting' | 'waiting' = 'idle';
  private hoveredButton: ButtonType | null = null;
  private panelHovered = false; // Track if panel is being pointed at (for visual feedback)
  
  // Button regions for raycasting (in canvas coordinates)
  private buttonRegions = {
    host: { x: 0, y: 0, w: 0, h: 0 },
    join: { x: 0, y: 0, w: 0, h: 0 },
    close: { x: 0, y: 0, w: 0, h: 0 },
  };
  
  // SPATIAL PLACEMENT: Grab state (like 3D models)
  private isGrabbed = false;
  private grabHand: 'left' | 'right' | null = null;
  private grabOffset = new THREE.Vector3();
  private userHasPositioned = false; // Track if user has manually positioned panel
  
  // GRAB PENDING: Wait for movement before grabbing (prevents accidental button clicks)
  private grabPending = false;
  private grabPendingHand: 'left' | 'right' | null = null;
  private grabPendingStartPos: THREE.Vector3 | null = null;
  private grabPendingStartTime = 0;
  private grabPendingButton: ButtonType | null = null; // Track if started on a button
  
  // UX Constants - IMPROVED for better responsiveness
  private readonly GRAB_MOVE_THRESHOLD = 0.02; // 2cm movement to trigger grab (was 5cm - too high)
  private readonly GRAB_MIN_HOLD_MS = 100; // 100ms minimum hold before grab activates (was 150ms)
  private readonly CLICK_MAX_MOVE = 0.015; // 1.5cm max movement for button click (more precise)
  
  constructor(scene: THREE.Scene, multiplayer: MultiplayerManager) {
    this.multiplayer = multiplayer;
    
    // Create canvas (like tutorial)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 768;  // Taller for buttons
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    // Create plane mesh (like tutorial) - COMFORTABLE SIZE for interaction
    const geo = new THREE.PlaneGeometry(0.6, 0.45);  // Larger for easier interaction
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,  // Enable depth test for proper 3D placement
      opacity: 1.0,
      depthWrite: false,  // Prevent z-fighting with other UI elements
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999;  // Always render on top
    // FLOATING UI: Position in easy-to-reach location (will be updated dynamically)
    // Start closer to user at comfortable height for interaction
    this.panel.position.set(0, 1.6, -0.8);  // 1.6m height (eye level), 0.8m in front for better reach
    this.group.add(this.panel);
    this.group.visible = false;
    
    scene.add(this.group);
    
    // Initial render
    this.render();
    
    console.log('[XRMultiplayerPanel] 🎮 Canvas-based FLOATING panel created');
  }
  
  /**
   * Render the panel content to canvas
   */
  private render(): void {
    const ctx = this.canvas.getContext('2d')!;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Background - solid black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    
    // VISUAL FEEDBACK: Add border to show panel state
    // Blue = hovered/grabbable, Green = being grabbed, White = idle
    if (this.isGrabbed) {
      // Being grabbed - bright green border
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);
    } else if (this.panelHovered || this.grabPending) {
      // Hovered or grab pending - bright blue border (grabbable)
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, w - 8, h - 8);
    } else {
      // Idle - subtle white border
      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, w - 4, h - 4);
    }
    
    // Title - COMPACT & READABLE
    ctx.fillStyle = '#00ff00';  // Bright green
    ctx.font = 'bold 70px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('MULTIPLAYER', w / 2, 90);
    
    // Status/instructions
    if (this.mode === 'idle') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '36px Arial';
      ctx.fillText('Point & pinch to select', w / 2, 160);
      
      // Help text - how to move panel
      ctx.fillStyle = '#888888';
      ctx.font = '24px Arial';
      ctx.fillText('💡 Pinch & move to reposition panel', w / 2, 200);
      
      // HOST button - BIGGER for easy pinch targeting
      const hostY = 240;
      const hostH = 140;
      this.buttonRegions.host = { x: 112, y: hostY, w: 800, h: hostH };
      this.drawButton(ctx, 'HOST', hostY, hostH, '#667eea', this.hoveredButton === 'host');
      
      // JOIN button - BIGGER for easy pinch targeting
      const joinY = 420;
      const joinH = 140;
      this.buttonRegions.join = { x: 112, y: joinY, w: 800, h: joinH };
      this.drawButton(ctx, 'JOIN', joinY, joinH, '#f5576c', this.hoveredButton === 'join');
      
      // Close button
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 362, y: closeY, w: 300, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#888888' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '40px Arial';
      ctx.fillText('X', w / 2, closeY + 55);
      
    } else if (this.mode === 'hosting') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '36px Arial';
      ctx.fillText('HOST SESSION CREATED!', w / 2, 200);
      
      ctx.font = '28px Arial';
      ctx.fillStyle = '#ffff00';  // Yellow
      ctx.fillText('Code copied to clipboard!', w / 2, 260);
      
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '24px Arial';
      ctx.fillText('Share code with friend:', w / 2, 320);
      ctx.fillText('1. Take off headset', w / 2, 360);
      ctx.fillText('2. Open browser on phone/desktop', w / 2, 395);
      ctx.fillText('3. Go to: [YOUR-URL]/connect.html', w / 2, 430);
      ctx.fillText('4. Paste code there', w / 2, 465);
      
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 22px monospace';
      const shortCode = this.currentCode.substring(0, 40) + '...';
      ctx.fillText(shortCode, w / 2, 540);
      
      // Close button - larger and more accessible
      const closeY = 620;
      const closeH = 90;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#ff4444' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      
      // Border for visual feedback
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(this.buttonRegions.close.x + 2, closeY + 2, this.buttonRegions.close.w - 4, closeH - 4);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px Arial';
      ctx.fillText('CLOSE', w / 2, closeY + 56);
      
    } else if (this.mode === 'waiting') {
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 48px Arial';
      ctx.fillText('Waiting for connection...', w / 2, 300);
      
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '32px Arial';
      ctx.fillText('Keep headset on', w / 2, 380);
      ctx.fillText('Connection will happen automatically', w / 2, 430);
    }
    
    // Update texture
    this.texture.needsUpdate = true;
  }
  
  private drawButton(ctx: CanvasRenderingContext2D, text: string, y: number, h: number, color: string, hovered: boolean): void {
    const w = this.canvas.width;
    const buttonW = 800;
    const buttonX = (w - buttonW) / 2;
    
    // IMPROVED: More obvious hover effect with glow
    if (hovered) {
      // Outer glow effect when hovered
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(buttonX, y, buttonW, h);
      ctx.shadowBlur = 0;
      
      // Bright border
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.strokeRect(buttonX + 3, y + 3, buttonW - 6, h - 6);
    } else {
      // Normal state - colored background
      ctx.fillStyle = color;
      ctx.fillRect(buttonX, y, buttonW, h);
      
      // Border for visual feedback
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeRect(buttonX + 2, y + 2, buttonW - 4, h - 4);
    }
    
    // Button text - BIG & BOLD with better contrast
    ctx.fillStyle = hovered ? color : '#ffffff';
    ctx.font = 'bold 64px Arial'; // Slightly bigger for better readability
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, y + h / 2 + 22);
  }
  
  /**
   * Handle button click
   */
  async handleClick(button: ButtonType): Promise<void> {
    console.log('[XRMultiplayerPanel] Button clicked:', button);
    
    switch (button) {
      case 'host':
        await this.handleHost();
        break;
      case 'join':
        // For now, show instructions (actual join needs web UI)
        this.mode = 'waiting';
        this.render();
        break;
      case 'close':
        this.hide();
        break;
    }
  }
  
  private async handleHost(): Promise<void> {
    this.mode = 'hosting';
    this.render();
    
    try {
      const offer = await this.multiplayer.createSession();
      this.currentCode = offer;
      
      // Copy to clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(offer).then(() => {
          console.log('[XRMultiplayerPanel] Code copied to clipboard');
        }).catch(err => {
          console.error('[XRMultiplayerPanel] Failed to copy:', err);
        });
      }
      
      this.render();
      console.log('[XRMultiplayerPanel] HOST CODE:', offer);
      
    } catch (error) {
      console.error('[XRMultiplayerPanel] Host error:', error);
      this.mode = 'idle';
      this.render();
    }
  }
  
  /**
   * Raycast to check if pointing at button OR panel (for grab/button interaction)
   * Returns { button, distance } if hitting a button
   * Returns { panel: true, distance, point } if hitting panel (but not button) - for grab
   */
  raycast(ray: THREE.Ray): { button?: ButtonType; panel?: boolean; distance: number; point?: THREE.Vector3 } | null {
    if (!this.visible) return null;
    
    // Raycast against panel mesh
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(ray);
    const intersects = raycaster.intersectObject(this.panel, false);
    
    if (intersects.length === 0) return null;
    
    const hit = intersects[0];
    const uv = hit.uv;
    if (!uv) return null;
    
    // Convert UV to canvas coordinates
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;  // Flip Y
    
    // Check which button was hit
    for (const [name, region] of Object.entries(this.buttonRegions)) {
      if (x >= region.x && x <= region.x + region.w &&
          y >= region.y && y <= region.y + region.h) {
        return { button: name as ButtonType, distance: hit.distance };
      }
    }
    
    // Hit panel but not a button - allow grabbing
    return { panel: true, distance: hit.distance, point: hit.point };
  }
  
  /**
   * Set button hover (for visual feedback)
   */
  setButtonHover(button: ButtonType | null): void {
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      this.render();
    }
  }
  
  /**
   * Set panel hover state (for visual feedback when panel is grabbable)
   */
  setPanelHover(hovered: boolean): void {
    if (this.panelHovered !== hovered) {
      this.panelHovered = hovered;
      this.render();
    }
  }
  
  show(camera?: THREE.Camera): void {
    this.group.visible = true;
    this.visible = true;
    this.mode = 'idle';
    
    // Position panel in front of camera at comfortable reach distance
    // Don't reset userHasPositioned if already shown - preserve user placement
    if (camera && !this.userHasPositioned) {
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(camDir);
      
      // Position panel 0.8m in front at eye height (1.6m) for better interaction
      this.group.position.copy(camPos.add(camDir.multiplyScalar(0.8)));
      this.group.position.y = 1.6; // Eye height for easy reach and visibility
      
      // Face camera
      this.group.lookAt(camPos);
    }
    
    this.render();
  }
  
  hide(): void {
    this.group.visible = false;
    this.visible = false;
  }
  
  isVisible(): boolean {
    return this.visible;
  }
  
  onConnectionChange(connected: boolean): void {
    if (connected) {
      this.mode = 'waiting';
      this.render();
      setTimeout(() => this.hide(), 3000);
    }
  }
  
  /**
   * Update panel position to float to the LEFT of the current 3D model
   * CRITICAL: Panel is STATIONARY in world space, not following head movement
   * SPATIAL PLACEMENT: Can be grabbed and placed anywhere by user
   * FIXED POSITION: Always 0.4m to the LEFT of object center (INDEPENDENT of scale)
   */
  update(camera: THREE.Camera, modelPosition?: THREE.Vector3, modelHeight?: number, handPosition?: THREE.Vector3): void {
    if (!this.visible) return;
    
    // If being grabbed, follow hand with offset - SMOOTH movement
    if (this.isGrabbed && handPosition) {
      const targetPos = handPosition.clone().add(this.grabOffset);
      
      // Smooth interpolation for more natural feel (lerp factor 0.3 = 30% per frame)
      this.group.position.lerp(targetPos, 0.3);
    } 
    // If model position provided and NOT grabbed, position panel to LEFT of it
    // ONLY if panel hasn't been manually positioned by user yet
    else if (modelPosition && !this.isGrabbed && !this.userHasPositioned) {
      // Get camera position to determine left direction
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      
      // Calculate right vector (camera's perspective)
      const toCamera = new THREE.Vector3().subVectors(camPos, modelPosition).normalize();
      toCamera.y = 0; // Keep on horizontal plane
      toCamera.normalize();
      
      // Calculate left vector (perpendicular to camera direction)
      const leftVector = new THREE.Vector3(-toCamera.z, 0, toCamera.x).normalize();
      
      // Position panel 0.4m to the LEFT of object center (FIXED distance, independent of scale)
      const FIXED_OFFSET = 0.4; // 40cm to the left
      this.group.position.copy(modelPosition);
      this.group.position.add(leftVector.multiplyScalar(FIXED_OFFSET));
      
      // Position at same height as object center (no dependence on height/scale)
      // This keeps it at a consistent, reachable position
    }
    
    // CRITICAL: Make panel face camera but keep it stationary in world space
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    this.group.lookAt(camPos);
  }
  
  /**
   * Start PENDING grab - waits for movement before actually grabbing
   * This prevents accidental button clicks when trying to move panel
   */
  startGrabPending(hand: 'left' | 'right', handPosition: THREE.Vector3, button?: ButtonType): void {
    this.grabPending = true;
    this.grabPendingHand = hand;
    this.grabPendingStartPos = handPosition.clone();
    this.grabPendingStartTime = performance.now();
    this.grabPendingButton = button || null;
    console.log('[XRMultiplayerPanel] ⏳ Grab pending -', button ? `on button: ${button}` : 'on panel');
  }
  
  /**
   * Update grab pending - check if hand moved enough to activate grab
   * Returns: 'grab' if grab activated, 'click' if should click button, 'pending' if still waiting, 'cancel' if canceled
   */
  updateGrabPending(handPosition: THREE.Vector3, isPinching: boolean): 'grab' | 'click' | 'pending' | 'cancel' {
    if (!this.grabPending || !this.grabPendingStartPos) return 'cancel';
    
    // If pinch released
    if (!isPinching) {
      const movement = handPosition.distanceTo(this.grabPendingStartPos);
      const wasOnButton = this.grabPendingButton !== null;
      
      // If minimal movement and was on button = CLICK
      if (movement < this.CLICK_MAX_MOVE && wasOnButton) {
        console.log('[XRMultiplayerPanel] 🖱️ Button click detected (movement:', (movement * 100).toFixed(1), 'cm)');
        this.cancelGrabPending();
        return 'click';
      }
      
      // Otherwise cancel
      console.log('[XRMultiplayerPanel] ❌ Grab canceled (released too early)');
      this.cancelGrabPending();
      return 'cancel';
    }
    
    // Check if hand moved enough to activate grab
    const movement = handPosition.distanceTo(this.grabPendingStartPos);
    const holdTime = performance.now() - this.grabPendingStartTime;
    
    if (movement >= this.GRAB_MOVE_THRESHOLD && holdTime >= this.GRAB_MIN_HOLD_MS) {
      // Movement detected + min hold time = ACTIVATE GRAB
      console.log('[XRMultiplayerPanel] 🖐️ Grab activated (movement:', (movement * 100).toFixed(1), 'cm)');
      this.activateGrab(this.grabPendingHand!, handPosition);
      return 'grab';
    }
    
    return 'pending';
  }
  
  /**
   * Activate actual grab (called after pending state confirms it's a grab, not a click)
   */
  private activateGrab(hand: 'left' | 'right', handPosition: THREE.Vector3): void {
    this.isGrabbed = true;
    this.grabHand = hand;
    this.grabOffset.copy(this.group.position).sub(handPosition);
    this.grabPending = false;
    this.grabPendingHand = null;
    this.grabPendingStartPos = null;
    this.grabPendingButton = null;
  }
  
  /**
   * Cancel grab pending
   */
  cancelGrabPending(): void {
    this.grabPending = false;
    this.grabPendingHand = null;
    this.grabPendingStartPos = null;
    this.grabPendingButton = null;
  }
  
  /**
   * Stop grabbing panel
   */
  stopGrab(): void {
    if (this.isGrabbed) {
      console.log('[XRMultiplayerPanel] 📍 Placed at', this.group.position);
      this.userHasPositioned = true; // User has manually positioned panel
    }
    this.isGrabbed = false;
    this.grabHand = null;
    this.grabOffset.set(0, 0, 0);
  }
  
  /**
   * Check if panel is currently being grabbed
   */
  isGrabbedByHand(hand: 'left' | 'right'): boolean {
    return this.isGrabbed && this.grabHand === hand;
  }
  
  /**
   * Check if panel is grabbed by any hand
   */
  isCurrentlyGrabbed(): boolean {
    return this.isGrabbed;
  }
  
  /**
   * Check if grab is pending (waiting for movement)
   */
  isGrabPending(): boolean {
    return this.grabPending;
  }
  
  /**
   * Get the button that was pressed during grab pending (for click after release)
   */
  getPendingButton(): ButtonType | null {
    return this.grabPendingButton;
  }
  
  dispose(): void {
    this.texture.dispose();
    this.panel.geometry.dispose();
    (this.panel.material as THREE.Material).dispose();
  }
}

