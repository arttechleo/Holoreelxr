/**
 * VRKeypad - Lightweight 3D keypad for entering Peer IDs in VR
 * Optimized for hand tracking (pinch/poke) with no frame-blocking operations
 */

import * as THREE from 'three';

type KeypadKey = 
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  | '-' | 'backspace' | 'clear' | 'connect';

interface KeyRegion {
  key: KeypadKey;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class VRKeypad {
  private group = new THREE.Group();
  private panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  
  // Key regions for raycasting
  private keyRegions: KeyRegion[] = [];
  
  // Panel dimensions
  private readonly PANEL_W = 0.8;  // 80cm wide
  private readonly PANEL_H = 0.6; // 60cm tall
  private readonly CANVAS_W = 1024;
  private readonly CANVAS_H = 768;
  
  // Hit detection
  private readonly HIT_THICKNESS = 0.1;
  
  // State
  private inputText = '';
  private hoveredKey: KeypadKey | null = null;
  private onInputChange?: (text: string) => void;
  private onConnect?: () => void;
  
  constructor(scene: THREE.Scene) {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.CANVAS_W;
    this.canvas.height = this.CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('VRKeypad: cannot get 2D context');
    this.ctx = ctx;
    
    // Create texture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    // Create plane mesh
    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.renderOrder = 10000; // Above other UI
    this.group.add(this.panel);
    scene.add(this.group);
    
    // Initially hidden
    this.group.visible = false;
    
    // Initial render
    this.render();
    
    console.log('[VRKeypad] Keypad created');
  }
  
  /**
   * Show keypad at position
   */
  show(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.visible = true;
    this.group.visible = true;
    this.group.position.copy(position);
    this.group.lookAt(lookAt);
    this.inputText = '';
    this.hoveredKey = null;
    this.render();
    console.log('[VRKeypad] Keypad shown');
  }
  
  /**
   * Hide keypad
   */
  hide(): void {
    this.visible = false;
    this.group.visible = false;
    this.hoveredKey = null;
    console.log('[VRKeypad] Keypad hidden');
  }
  
  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
  }
  
  /**
   * Set input change callback
   */
  onInput(callback: (text: string) => void): void {
    this.onInputChange = callback;
  }
  
  /**
   * Set connect callback
   */
  onConnectClick(callback: () => void): void {
    this.onConnect = callback;
  }
  
  /**
   * Get current input text
   */
  getInputText(): string {
    return this.inputText;
  }
  
  /**
   * Set input text (for external updates)
   */
  setInputText(text: string): void {
    this.inputText = text;
    this.render();
  }
  
  /**
   * Raycast to check key hit
   */
  raycastHit(ray: THREE.Ray): KeypadKey | null {
    if (!this.visible) return null;
    
    // Build plane for keypad
    const normal = new THREE.Vector3(0, 0, 1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.group.position);
    const hitPoint = new THREE.Vector3();
    const ok = ray.intersectPlane(plane, hitPoint);
    if (!ok) return null;
    
    // Reject if too far from center in Z
    if (Math.abs(hitPoint.z - this.group.position.z) > this.HIT_THICKNESS) return null;
    
    // Convert world point to panel space
    const dx = hitPoint.x - this.group.position.x;
    const dy = hitPoint.y - this.group.position.y;
    if (Math.abs(dx) > this.PANEL_W * 0.5 || Math.abs(dy) > this.PANEL_H * 0.5) return null;
    
    // Convert to UV coordinates
    const u = (dx / this.PANEL_W) + 0.5;
    const v = 0.5 - (dy / this.PANEL_H);
    const px = u * this.CANVAS_W;
    const py = v * this.CANVAS_H;
    
    // Check which key was hit
    for (const region of this.keyRegions) {
      if (px >= region.x && px <= region.x + region.w &&
          py >= region.y && py <= region.y + region.h) {
        return region.key;
      }
    }
    
    return null;
  }
  
  /**
   * Set hovered key (for visual feedback)
   */
  setHoveredKey(key: KeypadKey | null): void {
    if (this.hoveredKey !== key) {
      this.hoveredKey = key;
      this.render();
    }
  }
  
  /**
   * Handle key press
   */
  handleKeyPress(key: KeypadKey): void {
    if (key === 'backspace') {
      this.inputText = this.inputText.slice(0, -1);
    } else if (key === 'clear') {
      this.inputText = '';
    } else if (key === 'connect') {
      this.onConnect?.();
      return;
    } else {
      // Limit input length (Peer IDs are typically short)
      if (this.inputText.length < 30) {
        this.inputText += key;
      }
    }
    
    this.onInputChange?.(this.inputText);
    this.render();
  }
  
  /**
   * Update position to face camera
   */
  update(camera: THREE.Camera): void {
    if (!this.visible) return;
    
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    
    // Smoothly face camera
    this.group.lookAt(camPos);
  }
  
  /**
   * Render keypad
   */
  private render(): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);
    
    // Border
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    
    // Title
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ENTER PEER ID', w / 2, 50);
    
    // Input display
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(this.inputText || '...', w / 2, 110);
    
    // Draw keys
    this.keyRegions = [];
    const keySize = 60;
    const keySpacing = 10;
    const startX = 50;
    const startY = 150;
    
    // Row 1: 0-9
    const row1 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as KeypadKey[];
    this.drawKeyRow(ctx, row1, startX, startY, keySize, keySpacing);
    
    // Row 2: a-j
    const row2 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as KeypadKey[];
    this.drawKeyRow(ctx, row2, startX, startY + keySize + keySpacing, keySize, keySpacing);
    
    // Row 3: k-t
    const row3 = ['k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'] as KeypadKey[];
    this.drawKeyRow(ctx, row3, startX, startY + (keySize + keySpacing) * 2, keySize, keySpacing);
    
    // Row 4: u-z, dash
    const row4 = ['u', 'v', 'w', 'x', 'y', 'z', '-'] as KeypadKey[];
    this.drawKeyRow(ctx, row4, startX, startY + (keySize + keySpacing) * 3, keySize, keySpacing);
    
    // Row 5: Control keys
    const controlY = startY + (keySize + keySpacing) * 4;
    this.drawKey(ctx, 'backspace', startX, controlY, keySize * 2, keySize, '⌫');
    this.drawKey(ctx, 'clear', startX + (keySize + keySpacing) * 2.5, controlY, keySize * 2, keySize, 'CLEAR');
    this.drawKey(ctx, 'connect', startX + (keySize + keySpacing) * 5, controlY, keySize * 3, keySize, 'CONNECT', '#4caf50');
    
    // Update texture
    this.texture.needsUpdate = true;
  }
  
  /**
   * Draw a row of keys
   */
  private drawKeyRow(ctx: CanvasRenderingContext2D, keys: KeypadKey[], x: number, y: number, size: number, spacing: number): void {
    keys.forEach((key, i) => {
      this.drawKey(ctx, key, x + i * (size + spacing), y, size, size, key.toUpperCase());
    });
  }
  
  /**
   * Draw a single key
   */
  private drawKey(ctx: CanvasRenderingContext2D, key: KeypadKey, x: number, y: number, w: number, h: number, label: string, color: string = '#333333'): void {
    const isHovered = this.hoveredKey === key;
    
    // Store region for raycasting
    this.keyRegions.push({ key, x, y, w, h });
    
    // Key background
    ctx.fillStyle = isHovered ? '#ffffff' : color;
    ctx.fillRect(x, y, w, h);
    
    // Key border
    ctx.strokeStyle = isHovered ? '#00ff00' : '#666666';
    ctx.lineWidth = isHovered ? 4 : 2;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    
    // Key label
    ctx.fillStyle = isHovered ? '#000000' : '#ffffff';
    ctx.font = isHovered ? 'bold 32px Arial' : '28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }
  
  /**
   * Cleanup
   */
  dispose(): void {
    this.texture.dispose();
    this.panel.geometry.dispose();
    this.panel.material.dispose();
  }
}

