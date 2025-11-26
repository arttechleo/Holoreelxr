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
  private isPositionLocked = false; // Lock position to prevent drift
  private lastModelPosition: THREE.Vector3 | null = null; // Track model position changes
  private lastRenderState: string = ''; // Track render state to prevent redundant renders
  
  // GRAB PENDING: Wait for movement before grabbing (prevents accidental button clicks)
  private grabPending = false;
  private grabPendingHand: 'left' | 'right' | null = null;
  private grabPendingStartPos: THREE.Vector3 | null = null;
  private grabPendingStartTime = 0;
  private grabPendingButton: ButtonType | null = null; // Track if started on a button
  
  // UX Constants - SIMPLIFIED for better reliability
  private readonly GRAB_MOVE_THRESHOLD = 0.03; // 3cm movement to trigger grab (easier to activate)
  private readonly GRAB_MIN_HOLD_MS = 50; // 50ms minimum hold (very responsive)
  private readonly CLICK_MAX_MOVE = 0.02; // 2cm max movement for button click (more forgiving)
  
  constructor(scene: THREE.Scene, multiplayer: MultiplayerManager) {
    this.multiplayer = multiplayer;
    
    // Create canvas (like tutorial)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 768;  // Taller for buttons
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    // Create plane mesh (like tutorial) - MUCH LARGER for easier interaction and targeting
    const geo = new THREE.PlaneGeometry(0.8, 0.6);  // BIGGER! Was 0.6x0.45, now 0.8x0.6 (33% larger)
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,  // Disable depth test to prevent z-fighting flicker
      depthWrite: false, // Disable depth write to prevent flicker
      opacity: 1.0,
      alphaTest: 0.01,  // Lower threshold to reduce pixel discard flickering
      toneMapped: false, // Prevent tone mapping interference
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 999;  // High render order for overlay-like rendering
    this.panel.visible = true;     // Ensure panel mesh is visible
    this.panel.raycast = THREE.Mesh.prototype.raycast;  // Ensure raycast method exists
    this.panel.matrixAutoUpdate = true; // Ensure transforms update correctly
    this.panel.frustumCulled = false; // Don't cull - always render
    
    // FLOATING UI: Position in easy-to-reach location (will be updated dynamically)
    // Start closer to user at comfortable height for interaction
    this.panel.position.set(0, 1.5, -0.5);  // 1.5m height (eye level), 0.5m in front (CLOSER!)
    this.group.add(this.panel);
    this.group.visible = false;
    this.group.matrixAutoUpdate = true;
    
    scene.add(this.group);
    
    // Initial render
    this.render();
    
    console.log('[XRMultiplayerPanel] 🎮 Canvas-based FLOATING panel created');
  }
  
  /**
   * Render the panel content to canvas
   * OPTIMIZED: Only renders when state actually changes
   */
  private render(): void {
    // Generate state hash to check if we need to re-render
    const stateHash = `${this.mode}_${this.hoveredButton}_${this.panelHovered}_${this.isGrabbed}_${this.grabPending}`;
    
    // Skip render if nothing changed (prevents flickering from redundant draws)
    if (stateHash === this.lastRenderState && this.mode !== 'idle') {
      return;
    }
    this.lastRenderState = stateHash;
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
      // Being grabbed - bright green border with glow
      ctx.shadowColor = '#00ff00';
      ctx.shadowBlur = 30;
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.shadowBlur = 0;
    } else if (this.panelHovered || this.grabPending) {
      // Hovered or grab pending - bright blue border with glow (INTERACTIVE!)
      ctx.shadowColor = '#00aaff';
      ctx.shadowBlur = 25;
      ctx.strokeStyle = '#00aaff';
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.shadowBlur = 0;
      
      // Add "INTERACTIVE" indicator text when hovering
      ctx.fillStyle = '#00aaff';
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'right';
      ctx.fillText('👆 INTERACTIVE', w - 20, 40);
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
      ctx.font = '38px Arial';
      ctx.fillText('👉 Point & Pinch to Interact', w / 2, 160);
      
      // Help text - how to move panel
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '26px Arial';
      ctx.fillText('💡 Pinch panel edge & drag to move', w / 2, 200);
      
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
    
    // Update texture only when actually changed (prevent flicker from constant updates)
    this.texture.needsUpdate = true;
    
    // Ensure texture stays stable
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }
  
  private drawButton(ctx: CanvasRenderingContext2D, text: string, y: number, h: number, color: string, hovered: boolean): void {
    const w = this.canvas.width;
    const buttonW = 800;
    const buttonX = (w - buttonW) / 2;
    
    // IMPROVED: More obvious hover effect with glow and animation
    if (hovered) {
      // Animated glow effect when hovered - INTERACTIVE feedback
      ctx.shadowColor = color;
      ctx.shadowBlur = 35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(buttonX - 5, y - 5, buttonW + 10, h + 10);
      ctx.shadowBlur = 0;
      
      // Bright animated border
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      ctx.strokeRect(buttonX, y, buttonW, h);
      
      // Add "CLICK HERE" indicator
      ctx.fillStyle = color;
      ctx.font = 'bold 24px Arial';
      ctx.fillText('👆 CLICK', buttonX + buttonW + 80, y + h / 2 + 8);
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
    ctx.font = 'bold 68px Arial'; // Even bigger for better readability in VR
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, y + h / 2 + 24);
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
    
    // Normalize ray direction (critical for raycaster)
    const normalizedDir = ray.direction.clone().normalize();
    const raycaster = new THREE.Raycaster(ray.origin, normalizedDir);
    raycaster.near = 0.01;  // Very close
    raycaster.far = 100;    // Very far - ensure we catch the panel
    
    const intersects = raycaster.intersectObject(this.panel, false);
    
    // Debug logging (throttled)
    if (Math.random() < 0.1) { // 10% of calls for better debugging
      console.log('[XRMultiplayerPanel] Raycast check:', {
        panelWorldPos: this.panel.getWorldPosition(new THREE.Vector3()),
        panelVisible: this.visible,
        groupVisible: this.group.visible,
        rayOrigin: ray.origin,
        rayDirNormalized: normalizedDir,
        intersectsCount: intersects.length,
        panelMatrixWorld: this.panel.matrixWorld.elements.slice(12, 15) // Translation part
      });
    }
    
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
   * OPTIMIZED: Debounced to prevent excessive renders
   */
  private hoverUpdateTimeout: number | null = null;
  
  setButtonHover(button: ButtonType | null): void {
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      
      // Debounce render to prevent flicker from rapid hover changes
      if (this.hoverUpdateTimeout) {
        clearTimeout(this.hoverUpdateTimeout);
      }
      this.hoverUpdateTimeout = window.setTimeout(() => {
        this.render();
        this.hoverUpdateTimeout = null;
      }, 16); // ~60fps max update rate
    }
  }
  
  /**
   * Set panel hover state (for visual feedback when panel is grabbable)
   * OPTIMIZED: Debounced to prevent excessive renders
   */
  setPanelHover(hovered: boolean): void {
    if (this.panelHovered !== hovered) {
      this.panelHovered = hovered;
      
      // Debounce render to prevent flicker from rapid hover changes
      if (this.hoverUpdateTimeout) {
        clearTimeout(this.hoverUpdateTimeout);
      }
      this.hoverUpdateTimeout = window.setTimeout(() => {
        this.render();
        this.hoverUpdateTimeout = null;
      }, 16); // ~60fps max update rate
    }
  }
  
  show(camera?: THREE.Camera): void {
    this.group.visible = true;
    this.visible = true;
    this.mode = 'idle';
    
    // Position panel in front of camera at comfortable reach distance
    // Don't reset userHasPositioned if already shown - preserve user placement
    if (camera && !this.userHasPositioned && !this.isPositionLocked) {
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(camDir);
      
      // Position panel VERY CLOSE - 0.4m in front, directly in view for easy interaction
      this.group.position.copy(camPos.add(camDir.multiplyScalar(0.4)));
      this.group.position.y = 1.5; // Eye height for easy reach and visibility
      
      // Face camera
      this.group.lookAt(camPos);
      
      // Force matrix update for proper raycasting
      this.group.updateMatrixWorld(true);
      this.panel.updateMatrixWorld(true);
      
      // Lock position after showing to prevent drift
      setTimeout(() => {
        if (!this.userHasPositioned) {
          this.isPositionLocked = true;
          console.log('[XRMultiplayerPanel] 🔒 Initial position locked');
        }
      }, 1000); // Lock after 1 second
    }
    
    // Force initial render
    this.lastRenderState = ''; // Clear state to force render
    this.render();
    
    console.log('[XRMultiplayerPanel] 🎮 Panel shown - INTERACTIVE MODE enabled');
    console.log('[XRMultiplayerPanel] 📍 Group Position:', this.group.position);
    console.log('[XRMultiplayerPanel] 📍 Panel World Position:', this.panel.getWorldPosition(new THREE.Vector3()));
    console.log('[XRMultiplayerPanel] 👆 Point your finger and pinch to interact!');
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
   * Update panel position to float to the RIGHT of the current 3D model
   * CRITICAL: Panel LOCKS IN PLACE after initial positioning to prevent drift
   * SPATIAL PLACEMENT: Can be grabbed and placed anywhere by user
   * FIXED POSITION: Always 0.3m to the RIGHT of object center (INDEPENDENT of scale) - CLOSER!
   * Same side as reaction buttons (heart, like, repost)
   */
  update(camera: THREE.Camera, modelPosition?: THREE.Vector3, modelHeight?: number, handPosition?: THREE.Vector3): void {
    if (!this.visible) return;
    
    let positionChanged = false;
    
    // If being grabbed, follow hand with offset - SMOOTH movement
    if (this.isGrabbed && handPosition) {
      const targetPos = handPosition.clone().add(this.grabOffset);
      
      // Smooth interpolation for more natural feel (lerp factor 0.3 = 30% per frame)
      this.group.position.lerp(targetPos, 0.3);
      positionChanged = true;
      this.isPositionLocked = false; // Unlock while grabbing
    } 
    // If model position provided and NOT grabbed, position panel to RIGHT of it
    // ONLY ONCE - then lock position to prevent drift
    else if (modelPosition && !this.isGrabbed && !this.userHasPositioned && !this.isPositionLocked) {
      // Check if model position has changed significantly (more than 5cm)
      const modelMoved = !this.lastModelPosition || 
                         this.lastModelPosition.distanceTo(modelPosition) > 0.05;
      
      if (modelMoved) {
        // Get camera position to determine right direction
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);
        
        // Calculate direction from model to camera
        const toCamera = new THREE.Vector3().subVectors(camPos, modelPosition).normalize();
        toCamera.y = 0; // Keep on horizontal plane
        toCamera.normalize();
        
        // Calculate right vector (perpendicular to camera direction, to the right)
        const rightVector = new THREE.Vector3(toCamera.z, 0, -toCamera.x).normalize();
        
        // Position panel CLOSER to the RIGHT of object center for easy reach
        const FIXED_OFFSET = 0.3; // 30cm to the right (closer!)
        this.group.position.copy(modelPosition);
        this.group.position.add(rightVector.multiplyScalar(FIXED_OFFSET));
        
        // Position at comfortable eye level (slightly above model center)
        this.group.position.y = modelPosition.y + 0.1; // 10cm above model center
        
        this.lastModelPosition = modelPosition.clone();
        positionChanged = true;
        
        // Lock position after 2 seconds to prevent constant updates
        setTimeout(() => {
          this.isPositionLocked = true;
          console.log('[XRMultiplayerPanel] 🔒 Position locked to prevent drift');
        }, 2000);
      }
    }
    
    // ONLY update lookAt if position changed or not yet facing camera
    // This prevents constant rotation updates that cause flickering
    if (positionChanged || !this.isPositionLocked) {
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      this.group.lookAt(camPos);
      
      // Force matrix update only when needed
      this.group.updateMatrixWorld(true);
      this.panel.updateMatrixWorld(true);
    }
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
      this.isPositionLocked = true; // Lock position after manual placement
    }
    this.isGrabbed = false;
    this.grabHand = null;
    this.grabOffset.set(0, 0, 0);
  }
  
  /**
   * Reset position lock (for debugging or re-positioning)
   */
  unlockPosition(): void {
    this.isPositionLocked = false;
    this.userHasPositioned = false;
    this.lastModelPosition = null;
    console.log('[XRMultiplayerPanel] 🔓 Position unlocked - will reposition');
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
  
  /**
   * Check proximity-based interaction (fallback when raycast doesn't work)
   * Returns button if hand is close to a button region
   */
  checkProximity(handPosition: THREE.Vector3): { button?: ButtonType; distance: number } | null {
    if (!this.visible) return null;
    
    const panelWorldPos = this.panel.getWorldPosition(new THREE.Vector3());
    const distance = handPosition.distanceTo(panelWorldPos);
    
    // Panel is 0.8m x 0.6m, so max distance from center to corner is ~0.5m
    // Allow interaction within 0.6m of panel center
    const PROXIMITY_THRESHOLD = 0.6;
    
    if (distance > PROXIMITY_THRESHOLD) {
      return null;
    }
    
    // Hand is close to panel - check which button (if any)
    // Project hand position onto panel plane to get relative position
    const panelToHand = handPosition.clone().sub(panelWorldPos);
    
    // Get panel's local right and up vectors
    const panelRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.panel.getWorldQuaternion(new THREE.Quaternion()));
    const panelUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.panel.getWorldQuaternion(new THREE.Quaternion()));
    
    // Project onto panel axes
    const localX = panelToHand.dot(panelRight);
    const localY = panelToHand.dot(panelUp);
    
    // Panel is 0.8m wide, 0.6m tall, so local coords range from -0.4 to 0.4 in X, -0.3 to 0.3 in Y
    // Check if within panel bounds
    if (Math.abs(localX) > 0.4 || Math.abs(localY) > 0.3) {
      return null; // Outside panel
    }
    
    // Convert to UV-like coordinates (0 to 1)
    const u = (localX + 0.4) / 0.8; // 0 at left, 1 at right
    const v = (localY + 0.3) / 0.6; // 0 at bottom, 1 at top
    
    // Convert to canvas coordinates
    const x = u * this.canvas.width;
    const y = (1 - v) * this.canvas.height; // Flip Y for canvas
    
    // Check button regions
    for (const [name, region] of Object.entries(this.buttonRegions)) {
      if (x >= region.x && x <= region.x + region.w &&
          y >= region.y && y <= region.y + region.h) {
        console.log('[XRMultiplayerPanel] 🎯 Proximity hit on button:', name);
        return { button: name as ButtonType, distance };
      }
    }
    
    console.log('[XRMultiplayerPanel] 🎯 Proximity hit on panel (no button)');
    return { distance };
  }
  
  dispose(): void {
    this.texture.dispose();
    this.panel.geometry.dispose();
    (this.panel.material as THREE.Material).dispose();
  }
}

