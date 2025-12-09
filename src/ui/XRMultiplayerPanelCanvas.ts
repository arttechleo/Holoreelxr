/**
 * XRMultiplayerPanel - Canvas-based UI matching ReactionHud pattern EXACTLY
 * Positions to the RIGHT of 3D models (same system as Heart/Like/Repost)
 */

import * as THREE from 'three';
import { MultiplayerManager, VoiceState } from '../multiplayer/MultiplayerManager';
import { VRKeypad } from './VRKeypad';
import { MULTIPLAYER } from '../config/constants';
import {
  CanvasTheme,
  readCanvasThemeFromCSS,
  drawRoundedRect,
  applyPanelBackground,
} from './canvasTheme';

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
  // RIGHT side (positive X) - 80cm right, 20cm up, comfortable viewing distance
  private readonly OFFSET = new THREE.Vector3(0.80, 0.20, 0);
  
  // Hit detection thickness (like ReactionHud) - significantly increased for easier interaction
  private readonly HIT_THICKNESS = 0.08 * MULTIPLAYER.RAYCAST_THICKNESS_MULTIPLIER;
  
  // Touch-based interaction threshold (significantly increased for comfortable hand tracking)
  private readonly TOUCH_THRESHOLD = MULTIPLAYER.BUTTON_TOUCH_THRESHOLD;
  
  // Maximum interaction distance
  private readonly MAX_INTERACTION_DISTANCE = MULTIPLAYER.UI_RAYCAST_MAX_DISTANCE;
  
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
  
  // CRITICAL: Enabled flag - when false, panel is fully disabled (hidden + no updates)
  // This prevents flicker when Gaussian splats are active in WebXR
  private enabled = true;
  
  // Button interaction state
  private buttonHoverProgress = new Map<ButtonType, number>(); // 0.0 to 1.0 (visual feedback only)
  private buttonHoverStartTime = new Map<ButtonType, number>(); // timestamp when hover started
  private buttonLastClickTime = new Map<ButtonType, number>(); // debounce per button
  private activeButton: ButtonType | null = null; // button currently being pressed
  
  // Panel dimming state
  private baseOpacity = 1.0;
  private targetOpacity = 1.0;
  
  // Button regions for raycasting (in canvas coordinates)
  private buttonRegions = {
    host: { x: 0, y: 0, w: 0, h: 0 },
    join: { x: 0, y: 0, w: 0, h: 0 },
    close: { x: 0, y: 0, w: 0, h: 0 },
    voice: { x: 0, y: 0, w: 0, h: 0 },
    mute: { x: 0, y: 0, w: 0, h: 0 },
  };
  
  // Theme colors from CSS custom properties (shared helper)
  private theme: CanvasTheme = readCanvasThemeFromCSS();
  
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
      // CRITICAL: Sync keypad input with panel state and update display IMMEDIATELY
      // This callback is called every time a key is pressed
      console.log('[XRMultiplayerPanel] 🔔 Input callback - text:', text, 'mode:', this.mode);
      
      // Update joinInputCode with new text
      this.joinInputCode = text;
      
      // CRITICAL: Force immediate render to show typed text in real-time
      this.render();
      this.texture.needsUpdate = true; // Ensure texture is updated
      
      console.log('[XRMultiplayerPanel] ✅ Text field updated - joinInputCode:', this.joinInputCode);
    });
    this.keypad.onConnectClick(() => {
      // Connect button pressed on keypad
      this.executeJoin();
    });
    this.keypad.onCancelClick(() => {
      // Cancel button pressed - hide keypad and return to idle
      this.keypad?.hide();
      this.mode = 'idle';
      // CRITICAL: Clear input when canceling
      this.joinInputCode = '';
      // Also clear keypad's input text
      if (this.keypad) {
        this.keypad.setInputText('');
      }
      this.render();
      console.log('[XRMultiplayerPanel] Keypad cancelled - input cleared');
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
      // ✅ FIX FLICKER: Disable depth testing/writing to prevent Z-fighting with splats
      // Panel is now a true overlay that renders on top of everything
      depthTest: false,  // Ignore scene depth - panel always renders on top
      depthWrite: false // Don't write to depth buffer - doesn't affect splat rendering
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    // ✅ FIX FLICKER: High renderOrder ensures panel draws AFTER splats
    // Spark's splat pass goes first, then panel is composited on top
    this.panel.renderOrder = 10000;
    // Optional but helpful for UI planes: don't cull when outside frustum
    this.panel.frustumCulled = false;
    this.anchor.add(this.panel);
    scene.add(this.anchor);
    
    // Initialize button state tracking
    const allButtons: ButtonType[] = ['host', 'join', 'close', 'voice', 'mute'];
    allButtons.forEach(btn => {
      this.buttonHoverProgress.set(btn, 0.0);
      this.buttonHoverStartTime.set(btn, 0);
      this.buttonLastClickTime.set(btn, 0);
    });
    
    // Create raycast line material - grey/silver accent
    this.rayMaterial = new THREE.LineBasicMaterial({
      color: 0x888888,
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
    // Don't show if disabled (e.g., during splat viewing)
    if (!this.enabled) {
      console.log('[XRMultiplayerPanel] ⚠️ Cannot show panel - disabled (Gaussian splat active)');
      return;
    }
    this.visible = true;
    this.mode = 'idle';
    
    // CRITICAL: Ensure anchor is visible and in scene
    if (this.anchor) {
      this.anchor.visible = true;
      if (!this.anchor.parent && this.scene) {
        this.scene.add(this.anchor);
        console.log('[XRMultiplayerPanel.show] Re-added anchor to scene');
      }
    }
    
    // Ensure panel material is visible
    if (this.panel && this.panel.material) {
      (this.panel.material as THREE.MeshBasicMaterial).opacity = 1.0;
      (this.panel.material as THREE.MeshBasicMaterial).visible = true;
    }
    
    this.render();
    console.log('[XRMultiplayerPanel] 📺 Panel shown', {
      visible: this.visible,
      enabled: this.enabled,
      anchorVisible: this.anchor?.visible,
      anchorInScene: !!this.anchor?.parent,
      panelVisible: this.panel?.visible
    });
  }
  
  hide(): void {
    this.visible = false;
    console.log('[XRMultiplayerPanel] 🙈 Panel hidden');
  }
  
  isVisible(): boolean {
    return this.visible;
  }
  
  /**
   * Enable or disable the multiplayer panel.
   * When disabled:
   * - Panel is hidden (not visible in XR)
   * - Canvas rendering is stopped (no texture updates)
   * - All update logic is suspended (no per-frame updates)
   * - Raycasting is disabled (no hand interactions)
   * - Canvas texture is detached from material (prevents XR layer conflicts)
   * 
   * This is used to prevent phantom canvas artifacts when Gaussian splats are active in WebXR.
   * The panel should be disabled whenever a .ply or .spz splat is the active feed item.
   */
  setEnabled(isEnabled: boolean): void {
    if (this.enabled === isEnabled) return; // No change
    
    this.enabled = isEnabled;
    
    if (!isEnabled) {
      // DISABLE: Fully stop canvas-based rendering to prevent XR artifacts
      this.visible = false;
      if (this.anchor) {
        this.anchor.visible = false;
        // Remove from scene to ensure no XR layer submission
        if (this.anchor.parent) {
          this.anchor.parent.remove(this.anchor);
        }
      }
      // Detach texture from material to prevent canvas updates from affecting XR
      if (this.panel && this.panel.material) {
        (this.panel.material as THREE.MeshBasicMaterial).map = null;
        (this.panel.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
      // Hide keypad if visible
      this.keypad?.hide();
      console.log('[XRMultiplayerPanel] 🔴 Panel disabled + canvas detached (Gaussian splat active - prevents XR flicker)');
    } else {
      // ENABLE: Re-attach canvas texture and restore scene presence
      // Re-attach texture
      if (this.panel && this.panel.material && this.texture) {
        (this.panel.material as THREE.MeshBasicMaterial).map = this.texture;
        (this.panel.material as THREE.MeshBasicMaterial).needsUpdate = true;
        (this.panel.material as THREE.MeshBasicMaterial).visible = true;
        if (this.panel) {
          this.panel.visible = true;
        }
      }
      // Re-add to scene - CRITICAL: Always ensure anchor is in scene
      if (this.anchor && this.scene) {
        if (!this.anchor.parent) {
          this.scene.add(this.anchor);
          console.log('[XRMultiplayerPanel.setEnabled] Re-added anchor to scene');
        }
        // Force anchor and all children visible
        this.anchor.visible = true;
        this.anchor.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
            child.visible = true;
          }
        });
      }
      // Set visible flag - show() will also set it but let's be explicit
      this.visible = true;
      console.log('[XRMultiplayerPanel] 🟢 Panel enabled + canvas re-attached', {
        anchorInScene: !!this.anchor?.parent,
        anchorVisible: this.anchor?.visible,
        sceneExists: !!this.scene,
        panelVisible: this.panel?.visible,
        materialMap: !!(this.panel?.material as THREE.MeshBasicMaterial)?.map
      });
    }
  }
  
  isEnabled(): boolean {
    return this.enabled;
  }
  
  /**
   * Raycast in world space against the panel (matching ReactionHud pattern EXACTLY)
   * Enhanced with significantly increased interaction distance and proper plane orientation
   */
  raycastHit(ray: THREE.Ray, thickness = 10): MultiplayerHit {
    // CRITICAL: Disabled panels cannot be hit (prevents interaction during splat viewing)
    if (!this.enabled || !this.visible || !ray || !this.anchor) return null;
    
    try {
      // Get panel's world transform
      const panelWorldMatrix = this.anchor.matrixWorld;
      const panelWorldPos = new THREE.Vector3();
      const panelWorldNormal = new THREE.Vector3(0, 0, 1);
      panelWorldPos.setFromMatrixPosition(panelWorldMatrix);
      panelWorldNormal.applyMatrix4(panelWorldMatrix).sub(panelWorldPos).normalize();
      
      // Build plane for panel with correct world orientation
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(panelWorldNormal, panelWorldPos);
      const hitPoint = new THREE.Vector3();
      const ok = ray.intersectPlane(plane, hitPoint);
      if (!ok) return null;
      
      // Check distance from ray origin to hit point (reject if too far)
      const rayOrigin = ray.origin.clone();
      const distanceToHit = rayOrigin.distanceTo(hitPoint);
      if (distanceToHit > this.MAX_INTERACTION_DISTANCE) return null;
      
      // Reject if too far from center in plane normal direction - significantly increased threshold
      const effectiveThickness = this.HIT_THICKNESS * (thickness / 10);
      const distFromPlane = Math.abs(plane.distanceToPoint(hitPoint));
      if (distFromPlane > effectiveThickness) return null;
      
      // Convert world point to panel local space
      const worldToLocal = new THREE.Matrix4();
      worldToLocal.copy(panelWorldMatrix).invert();
      const localPos = new THREE.Vector3();
      localPos.copy(hitPoint);
      localPos.applyMatrix4(worldToLocal);
      
      // Panel is in XY plane in local space, centered at origin
      // Check if point is within panel bounds (with some padding for easier interaction)
      const padding = 0.05; // 5cm padding for easier interaction
      if (Math.abs(localPos.x) > this.PANEL_W * 0.5 + padding || 
          Math.abs(localPos.y) > this.PANEL_H * 0.5 + padding) return null;
      
      // Convert to UV coordinates (like ReactionHud)
      const u = (localPos.x / this.PANEL_W) + 0.5;
      const v = 0.5 - (localPos.y / this.PANEL_H);
      const px = u * this.CANVAS_W;
      const py = v * this.CANVAS_H;
      
      // Check which button was hit
      for (const [name, region] of Object.entries(this.buttonRegions)) {
        if (region.w > 0 && region.h > 0 && // Region must be valid
            px >= region.x && px <= region.x + region.w &&
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
   * Check touch-based interaction (proximity detection) for buttons
   * Returns the button being touched, or null if none
   * Enhanced with proper panel orientation handling
   */
  checkTouchInteraction(indexTip: THREE.Vector3): ButtonType | null {
    if (!this.visible || !this.anchor) return null;
    
    try {
      // Get panel plane normal (panel faces forward in local Z+ direction)
      const panelNormal = new THREE.Vector3(0, 0, 1);
      panelNormal.applyQuaternion(this.anchor.quaternion);
      const panelPos = this.anchor.position.clone();
      
      // Calculate distance from finger to panel plane
      const toPanel = indexTip.clone().sub(panelPos);
      const distToPlane = Math.abs(toPanel.dot(panelNormal));
      
      // Must be close to panel plane (within touch threshold) - significantly increased
      if (distToPlane > this.TOUCH_THRESHOLD) return null;
      
      // Also check distance from finger to panel center (reject if too far)
      const distToPanelCenter = indexTip.distanceTo(panelPos);
      if (distToPanelCenter > this.MAX_INTERACTION_DISTANCE) return null;
      
      // Project finger position onto panel plane
      const planeDist = toPanel.dot(panelNormal);
      const projected = indexTip.clone().sub(panelNormal.clone().multiplyScalar(planeDist));
      
      // Convert to panel local space
      const worldToLocal = new THREE.Matrix4();
      worldToLocal.copy(this.anchor.matrixWorld).invert();
      const localPos = new THREE.Vector3();
      localPos.copy(projected);
      localPos.applyMatrix4(worldToLocal);
      
      // Panel is in XY plane in local space, centered at origin
      // Convert to canvas coordinates (u: 0-1, v: 0-1)
      const u = (localPos.x / this.PANEL_W) + 0.5;
      const v = 0.5 - (localPos.y / this.PANEL_H);
      
      // Clamp to valid range
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      
      const px = u * this.CANVAS_W;
      const py = v * this.CANVAS_H;
      
      // Check which button region contains this point
      for (const [name, region] of Object.entries(this.buttonRegions)) {
        if (region.w > 0 && region.h > 0 && // Region must be valid
            px >= region.x && px <= region.x + region.w &&
            py >= region.y && py <= region.y + region.h) {
          return name as ButtonType;
        }
      }
      
      return null;
    } catch (error) {
      // Don't crash on touch detection errors
      if (typeof window !== 'undefined' && (window as any).__DEBUG_UI) {
        console.error('[XRMultiplayerPanel] Error in checkTouchInteraction:', error);
      }
      return null;
    }
  }
  
  /**
   * Set button hover (for visual feedback) - simplified and immediate
   */
  setButtonHover(button: ButtonType | null, dt: number = 0): void {
    const now = performance.now();
    
    // Reset hover progress for all buttons not being hovered
    const allButtons: ButtonType[] = ['host', 'join', 'close', 'voice', 'mute'];
    allButtons.forEach(btn => {
      if (btn !== button) {
        // Fade out hover progress when not hovered
        const currentProgress = this.buttonHoverProgress.get(btn) || 0;
        if (currentProgress > 0) {
          const fadeSpeed = 5.0; // faster fade out
          const newProgress = Math.max(0, currentProgress - fadeSpeed * dt);
          this.buttonHoverProgress.set(btn, newProgress);
          if (newProgress === 0) {
            this.buttonHoverStartTime.set(btn, 0);
          }
        }
      }
    });
    
    if (button) {
      // Update hover progress for the hovered button (visual feedback only)
      const startTime = this.buttonHoverStartTime.get(button) || 0;
      
      if (startTime === 0) {
        // Just started hovering
        this.buttonHoverStartTime.set(button, now);
      }
      
      // Calculate progress based on hover time (for visual feedback)
      const hoverDuration = now - startTime;
      const progress = Math.min(1.0, hoverDuration / (MULTIPLAYER.HOVER_GLOW_FILL_TIME_MS * 0.5)); // Faster glow
      this.buttonHoverProgress.set(button, progress);
    }
    
    if (this.hoveredButton !== button) {
      this.hoveredButton = button;
      this.render();
    } else if (button && dt > 0) {
      // Same button, but progress may have changed - re-render periodically
      this.render();
    }
  }
  
  /**
   * Get hover progress for a button (0.0 to 1.0) - visual feedback only
   */
  getButtonHoverProgress(button: ButtonType): number {
    return this.buttonHoverProgress.get(button) || 0.0;
  }
  
  /**
   * Check if button can be clicked (debounce check)
   */
  canClickButton(button: ButtonType): boolean {
    const now = performance.now();
    const lastClick = this.buttonLastClickTime.get(button) || 0;
    const debounceTime = MULTIPLAYER.CLICK_DEBOUNCE_MS;
    return (now - lastClick) >= debounceTime;
  }
  
  /**
   * Mark button as clicked (for debouncing)
   */
  markButtonClicked(button: ButtonType): void {
    this.buttonLastClickTime.set(button, performance.now());
    this.activeButton = button;
    // Clear active state after animation
    setTimeout(() => {
      if (this.activeButton === button) {
        this.activeButton = null;
        this.render();
      }
    }, 150);
  }
  
  /**
   * Handle button click - simplified and immediate
   * CRITICAL FIX: Enhanced error handling and debouncing
   */
  async handleClick(button: ButtonType): Promise<void> {
    // Debounce check
    if (!this.canClickButton(button)) {
      if (typeof window !== 'undefined' && (window as any).__DEBUG_UI) {
        console.log('[XRMultiplayerPanel] Button click debounced:', button);
      }
      return;
    }
    
    // Mark as clicked for debouncing
    this.markButtonClicked(button);
    this.render(); // Immediate visual feedback
    
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
    // CRITICAL: Don't clear joinInputCode - preserve any existing input
    // this.joinInputCode = ''; // REMOVED - preserve input
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
    
    // CRITICAL: Sync keypad inputText with panel's joinInputCode before showing
    if (this.keypad) {
      this.keypad.setInputText(this.joinInputCode);
    }
    
    this.keypad?.show(keypadPos, camPos);
    console.log('[XRMultiplayerPanel] Join mode - keypad shown, joinInputCode:', this.joinInputCode);
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
   * Added: Panel dimming when keypad is active
   * 
   * IMPORTANT: When disabled (e.g., during Gaussian splat viewing), this method
   * returns early to prevent any per-frame work and reduce CPU/GPU usage.
   */
  tick(dt: number): void {
    // CRITICAL: Disabled panels skip all update logic (performance optimization)
    if (!this.enabled || !this.visible) {
      return;
    }
    
    try {
      // Position anchor relative to object (like ReactionHud)
      // This automatically positions panel to the right of the 3D model
      const center = this.getObjectWorldPos();
      if (center && this.anchor) {
        // World-locked positioning: panel stays relative to object, not camera
        this.anchor.position.copy(center).add(this.OFFSET);
        
        // Make panel face camera for better visibility (billboard effect)
        const camera = this.getCamera();
        if (camera) {
          const cameraPos = new THREE.Vector3();
          camera.getWorldPosition(cameraPos);
          this.anchor.lookAt(cameraPos);
          // Rotate 180 degrees around Y to face camera (plane faces -Z by default)
          this.anchor.rotateY(Math.PI);
        }
      }
      
      // Update keypad position to face camera
      const keypadVisible = this.keypad?.isVisible() || false;
      
      if (keypadVisible) {
        try {
          const camera = this.getCamera();
          if (camera) {
            this.keypad?.update(camera);
          }
        } catch (error) {
          console.error('[XRMultiplayerPanel] Error updating keypad:', error);
        }
      }
      
      // Panel dimming: dim when keypad is active (foreground panel)
      this.targetOpacity = keypadVisible ? MULTIPLAYER.PANEL_DIMMED_OPACITY : 1.0;
      
      // Smooth opacity transition
      const opacitySpeed = 5.0; // faster transition for responsive feel
      this.baseOpacity += (this.targetOpacity - this.baseOpacity) * opacitySpeed * dt;
      this.panel.material.opacity = this.baseOpacity;
      
      // ENHANCED: Disable interaction when dimmed (keypad is active)
      if (keypadVisible) {
        // Panel is dimmed - keypad is in foreground, this panel should not be interactable
        // This is handled by UI priority system in FeedControls
      }
      
      // Update hover progress (fade out when not hovered)
      if (this.hoveredButton) {
        this.setButtonHover(this.hoveredButton, dt);
      } else {
        // Fade out all hover progress
        const allButtons: ButtonType[] = ['host', 'join', 'close', 'voice', 'mute'];
        allButtons.forEach(btn => {
          const currentProgress = this.buttonHoverProgress.get(btn) || 0;
          if (currentProgress > 0) {
            const fadeSpeed = 3.0;
            const newProgress = Math.max(0, currentProgress - fadeSpeed * dt);
            this.buttonHoverProgress.set(btn, newProgress);
            if (newProgress === 0) {
              this.buttonHoverStartTime.set(btn, 0);
            }
          }
        });
        // Re-render if progress changed
        if (allButtons.some(btn => (this.buttonHoverProgress.get(btn) || 0) > 0)) {
          this.render();
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
    // CRITICAL: Don't render canvas when disabled (prevents XR layer conflicts during GS mode)
    // This ensures canvas textures are not updated, which could cause phantom artifacts
    if (!this.enabled || !this.ctx) return;
    
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Clear + background
    ctx.clearRect(0, 0, w, h);
    applyPanelBackground(ctx, w, h, this.theme);
    
    // Reset button regions
    (Object.keys(this.buttonRegions) as Array<keyof typeof this.buttonRegions>).forEach((key) => {
      this.buttonRegions[key] = { x: 0, y: 0, w: 0, h: 0 };
    });
    
    // Outer rounded border - subtle vs accent on hover
    ctx.lineWidth = 10;
    ctx.strokeStyle = this.hoveredButton
      ? this.theme.panelBorderHover
      : this.theme.panelBorder;
    drawRoundedRect(ctx, 12, 12, w - 24, h - 24, 32);
    ctx.stroke();
    
    // Title - XR panel style
    ctx.fillStyle = this.theme.textPrimary;
    ctx.font = '600 60px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('MULTIPLAYER', w / 2, 48);
    
    // Status/instructions
    if (this.mode === 'idle') {
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = '500 32px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('👉 Point & pinch to interact', w / 2, 130);
      
      // HOST button – use CTA color
      const hostY = 220;
      const hostH = 120;
      this.buttonRegions.host = { x: 112, y: hostY, w: 800, h: hostH };
      this.drawButton(ctx, 'HOST', hostY, hostH, this.theme.cta, this.hoveredButton === 'host', 'host');
      
      // JOIN button – use accent color
      const joinY = 380;
      const joinH = 120;
      this.buttonRegions.join = { x: 112, y: joinY, w: 800, h: joinH };
      this.drawButton(ctx, 'JOIN', joinY, joinH, this.theme.accent, this.hoveredButton === 'join', 'join');
      
      // Close button – subtle chip style
      const closeY = 620;
      const closeH = 80;
      this.buttonRegions.close = { x: 362, y: closeY, w: 300, h: closeH };
      const closeHovered = this.hoveredButton === 'close';
      const closeActive = this.activeButton === 'close';
      const closeGlow = this.getButtonHoverProgress('close');
      
      const baseFill = closeActive
        ? this.theme.chipHover
        : closeHovered || closeGlow > 0
        ? this.theme.chipHover
        : this.theme.chip;
      
      ctx.shadowBlur = closeActive ? 20 : closeHovered || closeGlow > 0 ? 14 : 0;
      ctx.shadowColor = this.theme.panelBorderHover;
      
      ctx.fillStyle = baseFill;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.fill();
      
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this.theme.panelBorder;
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.stroke();
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = closeActive
        ? '600 40px -apple-system, system-ui, BlinkMacSystemFont, sans-serif'
        : '500 36px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLOSE', w / 2, closeY + closeH / 2);
      
    } else if (this.mode === 'hosting') {
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = '600 56px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('YOUR PEER ID:', w / 2, 120);
      
      // Display full Peer ID - primary text
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = '600 60px "JetBrains Mono", "SF Mono", Menlo, monospace';
      ctx.fillText(this.currentCode, w / 2, 220);
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = '500 28px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('Share this ID with friend', w / 2, 280);
      ctx.fillText('They can join using JOIN button', w / 2, 320);
      
      // Copy to clipboard hint
      ctx.fillStyle = this.theme.textDim;
      ctx.font = '400 22px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('(Code copied to console - check browser)', w / 2, 380);
      
      // Close button with enhanced visual feedback
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      const closeHovered = this.hoveredButton === 'close';
      const closeActive = this.activeButton === 'close';
      const closeGlow = this.getButtonHoverProgress('close');
      
      const baseFill = closeActive
        ? this.theme.chipHover
        : closeHovered || closeGlow > 0
        ? this.theme.chipHover
        : this.theme.chip;
      
      ctx.shadowBlur = closeActive ? 20 : closeHovered || closeGlow > 0 ? 14 : 0;
      ctx.shadowColor = this.theme.panelBorderHover;
      
      ctx.fillStyle = baseFill;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.fill();
      
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this.theme.panelBorder;
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.stroke();
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = closeActive
        ? '600 42px -apple-system, system-ui, BlinkMacSystemFont, sans-serif'
        : '500 38px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLOSE', w / 2, closeY + closeH / 2);
      
    } else if (this.mode === 'joining') {
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = '600 56px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('ENTER PEER ID', w / 2, 120);
      
      // Instructions - secondary text
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = '500 28px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('Touch keys on the keypad to type', w / 2, 190);
      ctx.fillText('Peer ID appears below in real time', w / 2, 230);
      
      // Input field background (semi-transparent dark card with rounded corners)
      const inputBoxW = w - 180;
      const inputBoxH = 120;
      const inputBoxX = (w - inputBoxW) / 2;
      const inputBoxY = 300;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = this.theme.panelBorder;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, inputBoxX, inputBoxY - inputBoxH / 2, inputBoxW, inputBoxH, 24);
      ctx.fill();
      ctx.stroke();
      
      // Render typed text (left-aligned inside card)
      const textPadding = 32;
      const textX = inputBoxX + textPadding;
      const textY = inputBoxY;
      const hasInput = this.joinInputCode.length > 0;
      const displayText = hasInput ? this.joinInputCode.toUpperCase() : 'TYPE CODE...';
      
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = hasInput 
        ? '600 60px "JetBrains Mono", "SF Mono", Menlo, monospace' 
        : '500 46px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = hasInput ? this.theme.textPrimary : this.theme.textDim;
      ctx.fillText(displayText, textX, textY);
      
      // Caret indicator (only when typing) - accent color
      if (hasInput) {
        const metrics = ctx.measureText(displayText);
        const caretX = textX + metrics.width + 10;
        const caretH = inputBoxH - 30;
        ctx.fillStyle = this.theme.accent;
        ctx.fillRect(caretX, textY - caretH / 2, 4, caretH);
      }
      ctx.restore();
      
      // Instructions for keypad - dim text
      ctx.fillStyle = this.theme.textDim;
      ctx.font = '400 22px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('Touch keypad keys with index finger to type', w / 2, 380);
      ctx.fillText('Press CONNECT when done', w / 2, 410);
      
      // Close button to go back with enhanced visual feedback
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      const closeHovered = this.hoveredButton === 'close';
      const closeActive = this.activeButton === 'close';
      const closeGlow = this.getButtonHoverProgress('close');
      
      const baseFill = closeActive
        ? this.theme.chipHover
        : closeHovered || closeGlow > 0
        ? this.theme.chipHover
        : this.theme.chip;
      
      ctx.shadowBlur = closeActive ? 20 : closeHovered || closeGlow > 0 ? 14 : 0;
      ctx.shadowColor = this.theme.panelBorderHover;
      
      ctx.fillStyle = baseFill;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.fill();
      
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this.theme.panelBorder;
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.stroke();
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = closeActive
        ? '600 42px -apple-system, system-ui, BlinkMacSystemFont, sans-serif'
        : '500 38px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BACK', w / 2, closeY + closeH / 2);
      
    } else if (this.mode === 'waiting') {
      // CRITICAL FIX: Add explicit close button to waiting mode
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = '600 56px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('CONNECTED', w / 2, 120);
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = '500 28px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('Multiplayer session active', w / 2, 200);

      if (this.voiceControls) {
        ctx.fillStyle = this.theme.textSecondary;
        ctx.font = '500 24px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
        ctx.fillText(this.getVoiceStatusText(), w / 2, 260);

        const voiceY = 320;
        const voiceH = 90;
        this.buttonRegions.voice = { x: 112, y: voiceY, w: 800, h: voiceH };
        const voiceLabel = this.voiceState.enabled ? 'VOICE READY' : 'VOICE ON';
        this.drawButton(ctx, voiceLabel, voiceY, voiceH, this.theme.accent, this.hoveredButton === 'voice', 'voice');

        if (this.voiceState.enabled) {
          const muteY = voiceY + 130;
          const muteH = 90;
          this.buttonRegions.mute = { x: 112, y: muteY, w: 800, h: muteH };
          const muteLabel = this.voiceState.muted ? 'UNMUTE' : 'MUTE';
          this.drawButton(ctx, muteLabel, muteY, muteH, this.theme.cta, this.hoveredButton === 'mute', 'mute');
        }
      }
      
      // Close button - explicit control with enhanced visual feedback
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      const closeHovered = this.hoveredButton === 'close';
      const closeActive = this.activeButton === 'close';
      const closeGlow = this.getButtonHoverProgress('close');
      
      const baseFill = closeActive
        ? this.theme.chipHover
        : closeHovered || closeGlow > 0
        ? this.theme.chipHover
        : this.theme.chip;
      
      ctx.shadowBlur = closeActive ? 20 : closeHovered || closeGlow > 0 ? 14 : 0;
      ctx.shadowColor = this.theme.panelBorderHover;
      
      ctx.fillStyle = baseFill;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.fill();
      
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this.theme.panelBorder;
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH, 40);
      ctx.stroke();
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = closeActive
        ? '600 42px -apple-system, system-ui, BlinkMacSystemFont, sans-serif'
        : '500 38px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLOSE', w / 2, closeY + closeH / 2);
      
    } else if (this.mode === 'waiting_old') {
      ctx.fillStyle = this.theme.textPrimary;
      ctx.font = '600 56px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('CONNECTING...', w / 2, 200);
      
      ctx.fillStyle = this.theme.textSecondary;
      ctx.font = '500 24px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
      ctx.fillText('Establishing connection', w / 2, 280);
      ctx.fillText('Please wait...', w / 2, 320);
    }
    
    // Update texture - CRITICAL: Always update texture after render
    this.texture.needsUpdate = true;
  }
  
  /**
   * Force render update (for external calls)
   */
  forceRender(): void {
    this.render();
  }
  
  private drawButton(
    ctx: CanvasRenderingContext2D,
    text: string,
    y: number,
    h: number,
    color: string,
    hovered: boolean,
    buttonType?: ButtonType
  ): void {
    const w = this.canvas.width;
    const buttonW = 800;
    const buttonX = (w - buttonW) / 2;
    
    const glowProgress = buttonType ? this.getButtonHoverProgress(buttonType) : 0;
    const isActive = buttonType ? this.activeButton === buttonType : false;
    
    const radius = 36;
    
    // Base styles derived from theme
    const baseFill = color || this.theme.accent;
    const hoverFill = buttonType === 'host' || buttonType === 'join'
      ? baseFill
      : this.theme.chipHover;
    const inactiveFill = buttonType === 'host' || buttonType === 'join'
      ? baseFill
      : this.theme.chip;
    
    // Background
    ctx.save();
    
    if (isActive) {
      ctx.shadowColor = this.theme.panelBorderHover;
      ctx.shadowBlur = 28;
      ctx.fillStyle = baseFill;
      drawRoundedRect(ctx, buttonX, y, buttonW, h, radius);
      ctx.fill();
    } else if (hovered || glowProgress > 0) {
      ctx.shadowColor = this.theme.panelBorderHover;
      ctx.shadowBlur = 20;
      ctx.fillStyle = hoverFill;
      drawRoundedRect(ctx, buttonX, y, buttonW, h, radius);
      ctx.fill();
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle = inactiveFill;
      drawRoundedRect(ctx, buttonX, y, buttonW, h, radius);
      ctx.fill();
    }
    
    // Border – subtle in normal, brighter with glow
    ctx.shadowBlur = 0;
    const hasGlow = glowProgress > 0;
    ctx.lineWidth = hasGlow ? 3 : 2;
    ctx.strokeStyle = hasGlow ? this.theme.panelBorderHover : this.theme.panelBorder;
    drawRoundedRect(ctx, buttonX + 1.5, y + 1.5, buttonW - 3, h - 3, radius - 2);
    ctx.stroke();
    
    // Button label
    ctx.fillStyle = this.theme.textPrimary;
    ctx.font = isActive
      ? '700 44px -apple-system, system-ui, BlinkMacSystemFont, sans-serif'
      : '600 40px -apple-system, system-ui, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, y + h / 2);
    
    ctx.restore();
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
