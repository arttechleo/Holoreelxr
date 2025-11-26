/**
 * XRMultiplayerPanel - Canvas-based UI matching ReactionHud pattern EXACTLY
 * Positions to the RIGHT of 3D models (same system as Heart/Like/Repost)
 */

import * as THREE from 'three';
import { MultiplayerManager, VoiceState } from '../multiplayer/MultiplayerManager';
import { VRKeypad } from './VRKeypad';

type ButtonType = 'host' | 'join' | 'close' | 'voice' | 'mute';

type VoiceControlHooks = {
  onStart: () => Promise<void>;
  onToggleMute: () => Promise<void> | void;
};

export type MultiplayerHit = 
  | { button: ButtonType; point?: THREE.Vector3 }
  | null;

export class XRMultiplayerPanel {
  private anchor = new THREE.Group(); // Like ReactionHud
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private multiplayer: MultiplayerManager;
  private visible = false;
  
  // Visual raycast lines
  private rayLine: THREE.Line | null = null;
  private rayMaterial: THREE.LineBasicMaterial;
  
  // Panel geometry (matching ReactionHud style)
  private readonly PANEL_W = 0.6;  // 60cm wide
  private readonly PANEL_H = 0.45; // 45cm tall
  private readonly CANVAS_W = 1024;
  private readonly CANVAS_H = 768;
  
  // Position offset (to the RIGHT of model, matching ReactionHud offset)
  // RIGHT side (positive X) - 50cm right, 5cm up
  private readonly OFFSET = new THREE.Vector3(0.50, 0.05, 0);
  
  // Hit detection thickness (like ReactionHud)
  private readonly HIT_THICKNESS = 0.08;
  
  // Callback to get object position
  private getObjectWorldPos: () => THREE.Vector3 | null;
  
  // VR Keypad for entering Peer ID
  private keypad: VRKeypad | null = null;
  private getCamera: () => THREE.Camera;
  
  // State
  private currentCode = ''; // Peer ID for connection
  private mode: 'idle' | 'hosting' | 'waiting' | 'joining' = 'idle';
  private hoveredButton: ButtonType | null = null;
  private isCreatingSession = false; // Prevent multiple simultaneous session creations
  private joinInputCode = ''; // Code entered for joining
  private voiceControls?: VoiceControlHooks;
  private voiceState: VoiceState = {
    enabled: false,
    muted: false,
    remoteReady: false,
    remoteActive: false,
    remoteMuted: false,
  };
  private voiceBusy = false;
  
  // Button regions for raycasting (in canvas coordinates)
  private buttonRegions = {
    host: { x: 0, y: 0, w: 0, h: 0 },
    join: { x: 0, y: 0, w: 0, h: 0 },
    close: { x: 0, y: 0, w: 0, h: 0 },
    voice: { x: 0, y: 0, w: 0, h: 0 },
    mute: { x: 0, y: 0, w: 0, h: 0 },
  };
  
  constructor(
    scene: THREE.Scene, 
    multiplayer: MultiplayerManager,
    getObjectWorldPos: () => THREE.Vector3 | null,
    getCamera: () => THREE.Camera
  ) {
    this.multiplayer = multiplayer;
    this.getObjectWorldPos = getObjectWorldPos;
    this.getCamera = getCamera;
    
    // Create VR keypad
    this.keypad = new VRKeypad(scene);
    this.keypad.onInput((text) => {
      // CRITICAL FIX: Sync keypad input with panel state and update display
      this.joinInputCode = text;
      this.render(); // Update panel display to show typed text
      // Debug logging only in development
      if (typeof window !== 'undefined' && (window as any).__DEBUG_UI) {
        console.log('[XRMultiplayerPanel] Input updated:', text);
      }
    });
    this.keypad.onConnectClick(() => {
      // Connect button pressed on keypad
      this.executeJoin();
    });
    this.keypad.onCancelClick(() => {
      // Cancel button pressed - hide keypad and return to idle
      this.keypad?.hide();
      this.mode = 'idle';
      this.joinInputCode = '';
      this.render();
      // Debug logging only in development
      if (typeof window !== 'undefined' && (window as any).__DEBUG_UI) {
        console.log('[XRMultiplayerPanel] Keypad cancelled');
      }
    });
    
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.CANVAS_W;
    this.canvas.height = this.CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('XRMultiplayerPanel: cannot get 2D context');
    this.ctx = ctx;
    
    // Create texture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    // Create plane mesh (matching ReactionHud exactly)
    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1.0,
      depthTest: true,  // Like ReactionHud
      depthWrite: false // Like ReactionHud
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 10000; // CRITICAL FIX: Lower than keypad (keypad is 20000)
    this.anchor.add(this.panel);
    scene.add(this.anchor);
    
    // Create raycast line material
    this.rayMaterial = new THREE.LineBasicMaterial({
      color: 0x00aaff,
      linewidth: 3,
      transparent: true,
      opacity: 0.8
    });
    
    // Initial render
    this.render();
    
    console.log('[XRMultiplayerPanel] Panel created');
  }
  
  // ============== PUBLIC API (like ReactionHud) ==============
  
  show(): void {
    this.visible = true;
    this.mode = 'idle';
    this.render();
    console.log('[XRMultiplayerPanel] 📺 Panel shown');
  }
  
  hide(): void {
    this.visible = false;
    console.log('[XRMultiplayerPanel] 🙈 Panel hidden');
  }
  
  isVisible(): boolean {
    return this.visible;
  }
  
  /**
   * Raycast in world space against the panel (matching ReactionHud pattern EXACTLY)
   */
  raycastHit(ray: THREE.Ray, thickness = 10): MultiplayerHit {
    if (!this.visible || !ray || !this.anchor) return null;
    
    try {
      // Build plane for panel (like ReactionHud)
    const normal = new THREE.Vector3(0, 0, 1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.anchor.position);
    const hitPoint = new THREE.Vector3();
    const ok = ray.intersectPlane(plane, hitPoint);
    if (!ok) return null;
    
    // Reject if too far from center in Z (like ReactionHud)
    if (Math.abs(hitPoint.z - this.anchor.position.z) > (this.HIT_THICKNESS * (thickness/10))) return null;
    
    // Convert world point to panel space (like ReactionHud)
    const dx = hitPoint.x - this.anchor.position.x;
    const dy = hitPoint.y - this.anchor.position.y;
    if (Math.abs(dx) > this.PANEL_W * 0.5 || Math.abs(dy) > this.PANEL_H * 0.5) return null;
    
    // Convert to UV coordinates (like ReactionHud)
    const u = (dx / this.PANEL_W) + 0.5;
    const v = 0.5 - (dy / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;
    
    // Check which button was hit
    for (const [name, region] of Object.entries(this.buttonRegions)) {
      if (px >= region.x && px <= region.x + region.w &&
          py >= region.y && py <= region.y + region.h) {
        return { button: name as ButtonType, point: hitPoint };
      }
    }
    
    return null; // Hit panel but no button
    } catch (error) {
      // CRITICAL FIX: Don't crash on raycast errors
      console.error('[XRMultiplayerPanel] Error in raycastHit:', error);
      return null;
    }
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
   * Handle button click
   * CRITICAL FIX: Enhanced error handling
   */
  async handleClick(button: ButtonType): Promise<void> {
    // Debug logging only in development
    if (typeof window !== 'undefined' && (window as any).__DEBUG_UI) {
      console.log('[XRMultiplayerPanel] 🖱️ Button clicked:', button);
    }
    
    try {
      switch (button) {
      case 'host':
        await this.handleHost();
        // Copy Peer ID to console for easy sharing
        if (this.currentCode) {
          console.log('[XRMultiplayerPanel] 📋 HOST PEER ID (copy this):', this.currentCode);
          // Try to copy to clipboard if available
          if (navigator.clipboard) {
            navigator.clipboard.writeText(this.currentCode).catch(() => {
              // Ignore clipboard errors
            });
          }
        }
        break;
      case 'join':
        if (this.mode === 'joining' && this.joinInputCode) {
          // In joining mode with code, execute join
          await this.executeJoin();
        } else {
          // Switch to joining mode
          await this.handleJoin();
        }
        break;
      case 'close':
        if (this.mode === 'joining') {
          // Hide keypad and go back to idle
          this.keypad?.hide();
          this.mode = 'idle';
          this.joinInputCode = '';
          this.render();
        } else if (this.mode === 'waiting') {
          // CRITICAL FIX: Close button in waiting mode - hide panel
          this.hide();
        } else {
          // Default: hide panel
          this.hide();
        }
        break;
      case 'voice':
        if (!this.voiceControls || this.voiceBusy) break;
        this.voiceBusy = true;
        try {
          await this.voiceControls.onStart();
        } catch (error) {
          console.error('[XRMultiplayerPanel] Voice start error:', error);
        } finally {
          this.voiceBusy = false;
        }
        break;
      case 'mute':
        if (!this.voiceControls || !this.voiceState.enabled) break;
        try {
          await this.voiceControls.onToggleMute();
        } catch (error) {
          console.error('[XRMultiplayerPanel] Voice mute toggle error:', error);
        }
        break;
      }
    } catch (error) {
      // CRITICAL FIX: Don't crash on button click errors
      console.error('[XRMultiplayerPanel] Error in handleClick:', error);
      // Reset to safe state
      this.mode = 'idle';
      this.render();
    }
  }
  
  private async handleHost(): Promise<void> {
    // CRITICAL FIX: Prevent multiple simultaneous session creations
    if (this.isCreatingSession) {
      console.warn('[XRMultiplayerPanel] Session creation already in progress, ignoring duplicate request');
      return;
    }
    
    this.isCreatingSession = true;
    this.mode = 'hosting';
    this.render(); // Immediate UI feedback - don't wait for async operations
    
    try {
      // CRITICAL FIX: Use setTimeout to yield to event loop before starting heavy async work
      // This prevents blocking the UI thread
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Create session with timeout to prevent freeze
      const sessionPromise = this.multiplayer.createSession();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Session creation timeout')), 15000)
      );
      
      const peerId = await Promise.race([sessionPromise, timeoutPromise]) as string;
      this.currentCode = peerId; // Use Peer ID directly
      
      this.render();
      console.log('[XRMultiplayerPanel] ✅ HOST PEER ID:', this.currentCode);
      
    } catch (error) {
      console.error('[XRMultiplayerPanel] Host error:', error);
      this.mode = 'idle';
      this.currentCode = '';
      this.render();
    } finally {
      // CRITICAL FIX: Always reset flag, even on error
      this.isCreatingSession = false;
    }
  }
  
  private async handleJoin(): Promise<void> {
    // Switch to joining mode - show keypad
    this.mode = 'joining';
    this.joinInputCode = '';
    this.render();
    
    // Show keypad in front of camera
    const camera = this.getCamera();
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    
    // Position keypad 0.7m in front, slightly below eye level
    const keypadPos = camPos.clone().add(camDir.multiplyScalar(0.7));
    keypadPos.y -= 0.15; // Lower for comfortable typing
    
    this.keypad?.show(keypadPos, camPos);
    console.log('[XRMultiplayerPanel] Join mode - keypad shown');
  }
  
  /**
   * Set join code (called from UI, connect.html, or browser console)
   * Expose globally for easy access: window.setMultiplayerJoinCode('peer-id')
   */
  setJoinCode(code: string): void {
    this.joinInputCode = code.trim();
    this.render();
    console.log('[XRMultiplayerPanel] Join code set:', this.joinInputCode);
  }
  
  /**
   * Get current host code (for sharing)
   */
  getHostCode(): string {
    return this.currentCode;
  }
  
  /**
   * Execute join with current code
   */
  async executeJoin(): Promise<void> {
    // Get code from keypad if available, otherwise use stored code
    const keypadCode = this.keypad?.getInputText() || '';
    const codeToUse = keypadCode || this.joinInputCode;
    
    if (!codeToUse || codeToUse.trim().length === 0) {
      console.warn('[XRMultiplayerPanel] No join code provided');
      return;
    }
    
    if (this.isCreatingSession) {
      console.warn('[XRMultiplayerPanel] Join already in progress');
      return;
    }
    
    this.isCreatingSession = true;
    this.mode = 'waiting';
    this.joinInputCode = codeToUse.trim(); // Store the code
    this.render();
    
    try {
      // Yield to event loop before async work (prevents blocking)
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const joinPromise = this.multiplayer.joinSession(this.joinInputCode);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Join timeout')), 15000)
      );
      
      await Promise.race([joinPromise, timeoutPromise]);
      
      console.log('[XRMultiplayerPanel] ✅ Successfully joined session!');
      
      // Hide keypad on successful connection
      this.keypad?.hide();
      
      // Connection change callback will update UI
      
    } catch (error) {
      console.error('[XRMultiplayerPanel] Join error:', error);
      this.mode = 'joining'; // Go back to joining mode so user can retry
      // Keep keypad visible and restore input
      const currentInput = this.keypad?.getInputText() || this.joinInputCode;
      this.joinInputCode = currentInput;
      this.render();
    } finally {
      this.isCreatingSession = false;
    }
  }
  
  onConnectionChange(connected: boolean): void {
    // CRITICAL FIX: Handle connection state changes safely
    try {
      if (connected) {
        this.mode = 'waiting';
        this.render();
        // CRITICAL FIX: Don't auto-hide - stay visible until user explicitly closes
        // User must press X/Close button to dismiss
        console.log('[XRMultiplayerPanel] ✅ Connection established');
      } else {
        // CRITICAL FIX: Handle disconnection gracefully
        console.log('[XRMultiplayerPanel] ⚠️ Connection lost');
        // Don't change mode immediately - let user see the disconnection
        // They can close manually or retry
      }
    } catch (error) {
      console.error('[XRMultiplayerPanel] Error in onConnectionChange:', error);
      // Don't crash on connection change errors
    }
  }

  setVoiceControls(controls: VoiceControlHooks): void {
    this.voiceControls = controls;
    this.render();
  }

  updateVoiceState(state: VoiceState): void {
    this.voiceState = state;
    this.render();
  }
  
  /**
   * Get keypad instance (for external access)
   */
  getKeypad(): VRKeypad | null {
    return this.keypad;
  }
  
  /**
   * Update panel position (like ReactionHud.tick) - call every frame
   * CRITICAL FIX: Enhanced error handling and null safety
   */
  tick(dt: number): void {
    if (!this.visible) return;
    
    try {
      // Position anchor relative to object (like ReactionHud)
      const center = this.getObjectWorldPos();
      if (center && this.anchor) {
        this.anchor.position.copy(center).add(this.OFFSET);
      }
      
      // Update keypad position to face camera
      if (this.keypad?.isVisible()) {
        try {
          const camera = this.getCamera();
          if (camera) {
            this.keypad.update(camera);
          }
        } catch (error) {
          console.error('[XRMultiplayerPanel] Error updating keypad:', error);
        }
      }
    } catch (error) {
      // CRITICAL FIX: Don't crash on tick errors
      console.error('[XRMultiplayerPanel] Error in tick:', error);
    }
  }
  
  /**
   * Show visual raycast line from hand to panel
   */
  showRayLine(handPos: THREE.Vector3, hitPoint: THREE.Vector3, scene: THREE.Scene): void {
    // Remove old line first
    this.hideRayLine(scene);
    
    // Create new line from hand to hit point
    const points = [handPos, hitPoint];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.rayLine = new THREE.Line(geometry, this.rayMaterial);
    this.rayLine.renderOrder = 10000;
    scene.add(this.rayLine);
  }
  
  /**
   * Hide raycast line
   */
  hideRayLine(scene: THREE.Scene): void {
    if (this.rayLine) {
      scene.remove(this.rayLine);
      this.rayLine.geometry.dispose();
      this.rayLine = null;
    }
  }

  private getVoiceStatusText(): string {
    if (!this.voiceControls) {
      return 'Voice chat unavailable';
    }
    if (!this.voiceState.enabled) {
      return 'Voice off — tap VOICE ON to enable';
    }
    if (!this.voiceState.remoteReady) {
      return 'Waiting for partner to enable voice...';
    }
    if (!this.voiceState.remoteActive) {
      return 'Voice ready — establishing audio link...';
    }
    if (this.voiceState.muted) {
      return 'You are muted';
    }
    if (this.voiceState.remoteMuted) {
      return 'Partner is muted';
    }
    return 'Voice live — speak freely';
  }
  
  // ============== RENDERING ==============
  
  private render(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Background - solid black with border
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    (Object.keys(this.buttonRegions) as Array<keyof typeof this.buttonRegions>).forEach((key) => {
      this.buttonRegions[key] = { x: 0, y: 0, w: 0, h: 0 };
    });
    
    // Border
    ctx.strokeStyle = this.hoveredButton ? '#00aaff' : '#444444';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    
    // Title
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 70px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('MULTIPLAYER', w / 2, 90);
    
    // Status/instructions
    if (this.mode === 'idle') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '36px Arial';
      ctx.fillText('👉 Point & Pinch to Interact', w / 2, 160);
      
      // HOST button
      const hostY = 240;
      const hostH = 140;
      this.buttonRegions.host = { x: 112, y: hostY, w: 800, h: hostH };
      this.drawButton(ctx, 'HOST', hostY, hostH, '#667eea', this.hoveredButton === 'host');
      
      // JOIN button
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
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 48px Arial';
      ctx.fillText('YOUR PEER ID:', w / 2, 120);
      
      // Display full Peer ID (shorter, cleaner than SDP)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 60px monospace';
      ctx.fillText(this.currentCode, w / 2, 220);
      
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '24px Arial';
      ctx.fillText('Share this ID with friend', w / 2, 280);
      ctx.fillText('They can join using JOIN button', w / 2, 320);
      
      // Copy to clipboard hint
      ctx.fillStyle = '#888888';
      ctx.font = '20px Arial';
      ctx.fillText('(Code copied to console - check browser)', w / 2, 380);
      
      // Close button
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#ff4444' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px Arial';
      ctx.fillText('CLOSE', w / 2, closeY + 56);
      
    } else if (this.mode === 'joining') {
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 48px Arial';
      ctx.fillText('ENTER PEER ID', w / 2, 120);
      
      // Instructions
      ctx.fillStyle = '#ffffff';
      ctx.font = '28px Arial';
      ctx.fillText('Use keypad to type', w / 2, 200);
      ctx.fillText('Peer ID below', w / 2, 240);
      
      // Show current input
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 36px monospace';
      const displayText = this.joinInputCode || '...';
      ctx.fillText(displayText, w / 2, 320);
      
      // Instructions for keypad
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '20px Arial';
      ctx.fillText('Pinch on keypad keys to type', w / 2, 380);
      ctx.fillText('Press CONNECT when done', w / 2, 410);
      
      // Close button to go back
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#ff4444' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px Arial';
      ctx.fillText('BACK', w / 2, closeY + 56);
      
    } else if (this.mode === 'waiting') {
      // CRITICAL FIX: Add explicit close button to waiting mode
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 48px Arial';
      ctx.fillText('CONNECTED', w / 2, 120);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '28px Arial';
      ctx.fillText('Multiplayer session active', w / 2, 200);

      if (this.voiceControls) {
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '24px Arial';
        ctx.fillText(this.getVoiceStatusText(), w / 2, 260);

        const voiceY = 320;
        const voiceH = 90;
        this.buttonRegions.voice = { x: 112, y: voiceY, w: 800, h: voiceH };
        const voiceLabel = this.voiceState.enabled ? 'VOICE READY' : 'VOICE ON';
        this.drawButton(ctx, voiceLabel, voiceY, voiceH, '#888888', this.hoveredButton === 'voice');

        if (this.voiceState.enabled) {
          const muteY = voiceY + 130;
          const muteH = 90;
          this.buttonRegions.mute = { x: 112, y: muteY, w: 800, h: muteH };
          const muteLabel = this.voiceState.muted ? 'UNMUTE' : 'MUTE';
          this.drawButton(ctx, muteLabel, muteY, muteH, '#444444', this.hoveredButton === 'mute');
        }
      }
      
      // Close button - explicit control
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#ff4444' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px Arial';
      ctx.fillText('CLOSE', w / 2, closeY + 56);
      
    } else if (this.mode === 'waiting_old') {
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 48px Arial';
      ctx.fillText('CONNECTING...', w / 2, 200);
      
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '24px Arial';
      ctx.fillText('Establishing connection', w / 2, 280);
      ctx.fillText('Please wait...', w / 2, 320);
    }
    
    // Update texture
    this.texture.needsUpdate = true;
  }
  
  private drawButton(ctx: CanvasRenderingContext2D, text: string, y: number, h: number, color: string, hovered: boolean): void {
    const w = this.canvas.width;
    const buttonW = 800;
    const buttonX = (w - buttonW) / 2;
    
    if (hovered) {
      // Hovered - white background
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(buttonX, y, buttonW, h);
      ctx.shadowBlur = 0;
      
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.strokeRect(buttonX + 3, y + 3, buttonW - 6, h - 6);
    } else {
      // Normal - colored background
      ctx.fillStyle = color;
      ctx.fillRect(buttonX, y, buttonW, h);
      
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeRect(buttonX + 2, y + 2, buttonW - 4, h - 4);
    }
    
    // Button text
    ctx.fillStyle = hovered ? color : '#ffffff';
    ctx.font = 'bold 68px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, y + h / 2 + 24);
  }
  
  dispose(): void {
    this.texture.dispose();
    this.panel.geometry.dispose();
    this.panel.material.dispose();
    this.rayMaterial.dispose();
    if (this.rayLine) {
      this.rayLine.geometry.dispose();
    }
  }
}
