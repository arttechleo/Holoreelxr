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
  
  // Button regions for raycasting (in canvas coordinates)
  private buttonRegions = {
    host: { x: 0, y: 0, w: 0, h: 0 },
    join: { x: 0, y: 0, w: 0, h: 0 },
    close: { x: 0, y: 0, w: 0, h: 0 },
  };
  
  constructor(scene: THREE.Scene, multiplayer: MultiplayerManager) {
    this.multiplayer = multiplayer;
    
    // Create canvas (like tutorial)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 768;  // Taller for buttons
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    // Create plane mesh (like tutorial) - COMPACT & READABLE
    const geo = new THREE.PlaneGeometry(0.5, 0.35);  // Compact size
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,  // Enable depth test for proper 3D placement
      opacity: 1.0,
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 9999;  // Always render on top
    // FLOATING UI: Position above 3D model (will be updated dynamically)
    this.panel.position.set(0, 0.6, 0);  // 60cm above model center
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
    
    // Title - COMPACT & READABLE
    ctx.fillStyle = '#00ff00';  // Bright green
    ctx.font = 'bold 70px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('MULTIPLAYER', w / 2, 90);
    
    // Status/instructions
    if (this.mode === 'idle') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '36px Arial';
      ctx.fillText('Tap to connect', w / 2, 160);
      
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
      
      // Close button
      const closeY = 620;
      const closeH = 70;
      this.buttonRegions.close = { x: 362, y: closeY, w: 300, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#888888' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '32px Arial';
      ctx.fillText('CLOSE', w / 2, closeY + 48);
      
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
    
    // Button background with border for depth
    ctx.fillStyle = hovered ? '#ffffff' : color;
    ctx.fillRect(buttonX, y, buttonW, h);
    
    // Border for visual feedback
    if (!hovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeRect(buttonX + 2, y + 2, buttonW - 4, h - 4);
    }
    
    // Button text - BIG & BOLD
    ctx.fillStyle = hovered ? color : '#ffffff';
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, y + h / 2 + 20);
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
   * Raycast to check if pointing at button
   */
  raycast(ray: THREE.Ray): { button: ButtonType; distance: number } | null {
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
    
    return null;
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
  
  show(): void {
    this.group.visible = true;
    this.visible = true;
    this.mode = 'idle';
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
   * Update panel position to float above the current 3D model
   * CRITICAL: Panel is STATIONARY in world space, not following head movement
   */
  update(camera: THREE.Camera, modelPosition?: THREE.Vector3, modelHeight?: number): void {
    if (!this.visible) return;
    
    // If model position provided, position panel above it
    if (modelPosition && modelHeight) {
      this.group.position.copy(modelPosition);
      this.group.position.y += modelHeight + 0.3;  // 30cm above model top
    }
    
    // CRITICAL: Make panel face camera but keep it stationary in world space
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    this.group.lookAt(camPos);
  }
  
  dispose(): void {
    this.texture.dispose();
    this.panel.geometry.dispose();
    (this.panel.material as THREE.Material).dispose();
  }
}

