/**
 * XRMultiplayerPanel - Canvas-based UI matching ReactionHud pattern EXACTLY
 * Positions to the RIGHT of 3D models (same system as Heart/Like/Repost)
 */

import * as THREE from 'three';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager';

type ButtonType = 'host' | 'join' | 'close';

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
  private readonly OFFSET = new THREE.Vector3(0.50, 0.05, 0); // RIGHT side (positive X) - moved 15cm further right
  
  // Hit detection thickness (like ReactionHud)
  private readonly HIT_THICKNESS = 0.08;
  
  // Callback to get object position
  private getObjectWorldPos: () => THREE.Vector3 | null;
  
  // State
  private currentCode = '';
  private mode: 'idle' | 'hosting' | 'waiting' = 'idle';
  private hoveredButton: ButtonType | null = null;
  
  // Button regions for raycasting (in canvas coordinates)
  private buttonRegions = {
    host: { x: 0, y: 0, w: 0, h: 0 },
    join: { x: 0, y: 0, w: 0, h: 0 },
    close: { x: 0, y: 0, w: 0, h: 0 },
  };
  
  constructor(
    scene: THREE.Scene, 
    multiplayer: MultiplayerManager,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.multiplayer = multiplayer;
    this.getObjectWorldPos = getObjectWorldPos;
    
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
    this.panel.renderOrder = 9999; // Same as ReactionHud
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
    if (!this.visible) return null;
    
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
   */
  async handleClick(button: ButtonType): Promise<void> {
    console.log('[XRMultiplayerPanel] 🖱️ Button clicked:', button);
    
    switch (button) {
      case 'host':
        await this.handleHost();
        break;
      case 'join':
        await this.handleJoin();
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
  
  private async handleJoin(): Promise<void> {
    this.mode = 'waiting';
    this.render();
    
    // Get code from clipboard
    try {
      if (navigator.clipboard) {
        const code = await navigator.clipboard.readText();
        if (code && code.length > 20) {
          this.currentCode = code;
          await this.multiplayer.joinSession(code);
          console.log('[XRMultiplayerPanel] Joined session with code:', code);
        } else {
          console.error('[XRMultiplayerPanel] No valid code in clipboard');
          this.mode = 'idle';
        }
      }
      this.render();
    } catch (error) {
      console.error('[XRMultiplayerPanel] Join error:', error);
      this.mode = 'idle';
      this.render();
    }
  }
  
  onConnectionChange(connected: boolean): void {
    if (connected) {
      this.mode = 'waiting';
      this.render();
      setTimeout(() => this.hide(), 3000);
    }
  }
  
  /**
   * Update panel position (like ReactionHud.tick) - call every frame
   */
  tick(dt: number): void {
    if (!this.visible) return;
    
    // Position anchor relative to object (like ReactionHud)
    const center = this.getObjectWorldPos();
    if (center) {
      this.anchor.position.copy(center).add(this.OFFSET);
    }
  }
  
  /**
   * Show visual raycast line from hand to panel
   */
  showRayLine(handPos: THREE.Vector3, hitPoint: THREE.Vector3, scene: THREE.Scene): void {
    // Remove old line
    if (this.rayLine) {
      scene.remove(this.rayLine);
      this.rayLine.geometry.dispose();
    }
    
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
      ctx.fillText('SESSION CODE:', w / 2, 120);
      
      // Display code in chunks for readability
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px monospace';
      const codeLength = this.currentCode.length;
      const chunkSize = 8;
      let yPos = 200;
      
      for (let i = 0; i < codeLength; i += chunkSize) {
        const chunk = this.currentCode.substring(i, i + chunkSize);
        ctx.fillText(chunk, w / 2, yPos);
        yPos += 60;
        if (yPos > 550) break; // Don't overflow
      }
      
      ctx.fillStyle = '#ffff00';
      ctx.font = '24px Arial';
      ctx.fillText('(Copied to clipboard)', w / 2, yPos + 20);
      
      // Close button
      const closeY = 650;
      const closeH = 80;
      this.buttonRegions.close = { x: 312, y: closeY, w: 400, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#ff4444' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px Arial';
      ctx.fillText('CLOSE', w / 2, closeY + 56);
      
    } else if (this.mode === 'waiting') {
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 48px Arial';
      ctx.fillText('JOINING SESSION...', w / 2, 120);
      
      // Display code if available
      if (this.currentCode) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px monospace';
        const codeLength = this.currentCode.length;
        const chunkSize = 8;
        let yPos = 200;
        
        for (let i = 0; i < codeLength; i += chunkSize) {
          const chunk = this.currentCode.substring(i, i + chunkSize);
          ctx.fillText(chunk, w / 2, yPos);
          yPos += 60;
          if (yPos > 550) break;
        }
      }
      
      ctx.fillStyle = '#ffff00';
      ctx.font = '32px Arial';
      ctx.fillText('Waiting for connection...', w / 2, 600);
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
