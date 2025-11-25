/**
 * Loading Indicator for XR
 * Shows visual feedback during long operations (model loading, etc.)
 */

import * as THREE from 'three';

export class LoadingIndicator {
  private group = new THREE.Group();
  private spinner?: THREE.Mesh;
  private text?: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private isVisible = false;
  private animationFrame = 0;
  
  constructor() {
    this.group.name = 'LoadingIndicator';
    
    // Create canvas for text
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    
    this.createSpinner();
    this.createText();
    
    this.group.visible = false;
  }
  
  private createSpinner() {
    // Create a ring spinner
    const geometry = new THREE.TorusGeometry(0.08, 0.02, 16, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x4ECDC4,
      transparent: true,
      opacity: 0.9,
    });
    
    this.spinner = new THREE.Mesh(geometry, material);
    this.spinner.position.set(0, 0, 0);
    this.group.add(this.spinner);
  }
  
  private createText() {
    const material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1.0,
    });
    
    this.text = new THREE.Sprite(material);
    this.text.scale.set(0.5, 0.125, 1);
    this.text.position.set(0, -0.15, 0);
    this.group.add(this.text);
  }
  
  private updateText(message: string) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, this.canvas.width / 2, this.canvas.height / 2);
    
    this.texture.needsUpdate = true;
  }
  
  show(message: string = 'Loading...') {
    this.isVisible = true;
    this.group.visible = true;
    this.updateText(message);
  }
  
  hide() {
    this.isVisible = false;
    this.group.visible = false;
  }
  
  updateMessage(message: string) {
    if (this.isVisible) {
      this.updateText(message);
    }
  }
  
  update(deltaTime: number) {
    if (!this.isVisible || !this.spinner) return;
    
    // Rotate spinner
    this.animationFrame += deltaTime * 2;
    this.spinner.rotation.z = this.animationFrame;
    
    // Pulse effect
    const pulse = 0.9 + Math.sin(this.animationFrame * 2) * 0.1;
    this.spinner.scale.setScalar(pulse);
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
    this.texture.dispose();
    if (this.spinner) {
      this.spinner.geometry.dispose();
      (this.spinner.material as THREE.Material).dispose();
    }
    if (this.text) {
      (this.text.material as THREE.SpriteMaterial).dispose();
    }
  }
}

