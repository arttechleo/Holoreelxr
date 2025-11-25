/**
 * Error Panel for XR
 * Shows user-friendly error messages with recovery actions
 */

import * as THREE from 'three';

export type ErrorType = 'network' | 'loading' | 'xr' | 'gesture' | 'general';

export interface ErrorPanelOptions {
  title: string;
  message: string;
  type: ErrorType;
  actions?: Array<{ label: string; callback: () => void }>;
  autoHide?: number; // Auto-hide after N milliseconds
}

export class ErrorPanel {
  private group = new THREE.Group();
  private panel?: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private isVisible = false;
  private autoHideTimer?: number;
  
  constructor() {
    this.group.name = 'ErrorPanel';
    
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    this.createPanel();
    this.group.visible = false;
  }
  
  private createPanel() {
    const geometry = new THREE.PlaneGeometry(0.8, 0.4);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.98,
    });
    
    this.panel = new THREE.Mesh(geometry, material);
    this.group.add(this.panel);
  }
  
  private getIconForType(type: ErrorType): string {
    switch (type) {
      case 'network':
        return '🌐';
      case 'loading':
        return '⏳';
      case 'xr':
        return '🥽';
      case 'gesture':
        return '👋';
      default:
        return '⚠️';
    }
  }
  
  private getColorForType(type: ErrorType): string {
    switch (type) {
      case 'network':
        return '#FF6B6B';
      case 'loading':
        return '#FFD93D';
      case 'xr':
        return '#F38181';
      case 'gesture':
        return '#AA96DA';
      default:
        return '#FF3355';
    }
  }
  
  private draw(options: ErrorPanelOptions) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Background
    const bgColor = this.getColorForType(options.type);
    const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, bgColor + 'DD');
    gradient.addColorStop(1, bgColor + '99');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, this.canvas.width - 4, this.canvas.height - 4);
    
    // Icon
    const icon = this.getIconForType(options.type);
    ctx.font = '80px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(icon, this.canvas.width / 2, 80);
    
    // Title
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(options.title, this.canvas.width / 2, 160);
    
    // Message
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#eeeeee';
    this.wrapText(ctx, options.message, this.canvas.width / 2, 220, this.canvas.width - 100, 32);
    
    // Actions
    if (options.actions && options.actions.length > 0) {
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Tap panel to retry', this.canvas.width / 2, this.canvas.height - 40);
    }
    
    this.texture.needsUpdate = true;
  }
  
  private wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    
    for (const word of words) {
      const testLine = line + (line ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line, x, currentY);
        line = word;
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    
    if (line) {
      ctx.fillText(line, x, currentY);
    }
  }
  
  show(options: ErrorPanelOptions) {
    this.isVisible = true;
    this.group.visible = true;
    this.draw(options);
    
    // Clear existing timer
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = undefined;
    }
    
    // Auto-hide if specified
    if (options.autoHide && options.autoHide > 0) {
      this.autoHideTimer = window.setTimeout(() => {
        this.hide();
      }, options.autoHide);
    }
  }
  
  hide() {
    this.isVisible = false;
    this.group.visible = false;
    
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = undefined;
    }
  }
  
  setPosition(position: THREE.Vector3) {
    this.group.position.copy(position);
  }
  
  lookAt(target: THREE.Vector3) {
    this.group.lookAt(target);
  }
  
  getGroup(): THREE.Group {
    return this.group;
  }
  
  dispose() {
    this.hide();
    this.texture.dispose();
    if (this.panel) {
      this.panel.geometry.dispose();
      (this.panel.material as THREE.Material).dispose();
    }
  }
}

