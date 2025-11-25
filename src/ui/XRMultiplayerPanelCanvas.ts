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
    
    // Create plane mesh (like tutorial)
    const geo = new THREE.PlaneGeometry(0.9, 0.6);  // Slightly bigger
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      opacity: 1.0,
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.position.set(0, 1.5, -0.5);  // In front of user
    this.group.add(this.panel);
    this.group.visible = false;
    
    scene.add(this.group);
    
    // Initial render
    this.render();
    
    console.log('[XRMultiplayerPanel] 🎮 Canvas-based panel created');
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
    
    // Title
    ctx.fillStyle = '#00ff00';  // Bright green
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('MULTIPLAYER', w / 2, 100);
    
    // Status/instructions
    if (this.mode === 'idle') {
      ctx.fillStyle = '#ffffff';
      ctx.font = '40px Arial';
      ctx.fillText('Join a friend in XR!', w / 2, 180);
      ctx.font = '28px Arial';
      ctx.fillStyle = '#aaaaaa';
      ctx.fillText('Use hand to tap buttons below', w / 2, 230);
      
      // HOST button
      const hostY = 320;
      const hostH = 100;
      this.buttonRegions.host = { x: 112, y: hostY, w: 800, h: hostH };
      this.drawButton(ctx, 'HOST SESSION', hostY, hostH, '#667eea', this.hoveredButton === 'host');
      
      // JOIN button
      const joinY = 450;
      const joinH = 100;
      this.buttonRegions.join = { x: 112, y: joinY, w: 800, h: joinH };
      this.drawButton(ctx, 'JOIN SESSION', joinY, joinH, '#f5576c', this.hoveredButton === 'join');
      
      // Close button
      const closeY = 650;
      const closeH = 70;
      this.buttonRegions.close = { x: 362, y: closeY, w: 300, h: closeH };
      ctx.fillStyle = this.hoveredButton === 'close' ? '#888888' : '#444444';
      ctx.fillRect(this.buttonRegions.close.x, closeY, this.buttonRegions.close.w, closeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '32px Arial';
      ctx.fillText('CLOSE', w / 2, closeY + 48);
      
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
    
    // Button background
    ctx.fillStyle = hovered ? '#ffffff' : color;
    ctx.fillRect(buttonX, y, buttonW, h);
    
    // Button text
    ctx.fillStyle = hovered ? color : '#ffffff';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, y + h / 2 + 16);
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
   * Update panel to face camera
   */
  update(camera: THREE.Camera): void {
    if (!this.visible) return;
    
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

