/**
 * ✨ Particle System for VR
 * 
 * Creates beautiful particle effects for reactions and interactions
 */

import * as THREE from 'three';

export type ParticleType = 'heart' | 'like' | 'repost' | 'sparkle' | 'confetti' | 'emoji';

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
  rotation: number;
  rotationSpeed: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private scene: THREE.Scene;
  private pool: THREE.Sprite[] = []; // Object pooling for performance
  
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializePool(50); // Pre-create 50 sprites
  }

  private initializePool(count: number) {
    for (let i = 0; i < count; i++) {
      const sprite = this.createSprite('✨');
      sprite.visible = false;
      this.scene.add(sprite);
      this.pool.push(sprite);
    }
  }

  private createSprite(emoji: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    
    ctx.font = '96px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
    });
    
    return new THREE.Sprite(material);
  }

  emit(type: ParticleType, position: THREE.Vector3, count: number = 10) {
    const emoji = this.getEmojiForType(type);
    
    for (let i = 0; i < count; i++) {
      const sprite = this.getFromPool(emoji);
      if (!sprite) continue;
      
      sprite.position.copy(position);
      sprite.position.x += (Math.random() - 0.5) * 0.1;
      sprite.position.y += (Math.random() - 0.5) * 0.1;
      sprite.position.z += (Math.random() - 0.5) * 0.1;
      
      sprite.scale.set(0.05, 0.05, 1);
      sprite.visible = true;
      
      // FIX: More aggressive upward velocity to prevent stuck particles
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,      // More horizontal spread
        Math.random() * 0.8 + 0.5,        // Stronger upward velocity
        (Math.random() - 0.5) * 0.5       // More depth spread
      );
      
      // FIX: Shorter lifetime to prevent particles getting stuck in view
      this.particles.push({
        sprite,
        velocity,
        lifetime: 0,
        maxLifetime: type === 'confetti' ? 1.2 : 0.8,  // Reduced from 2.0/1.5 to 1.2/0.8
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 5,
      });
    }
  }

  private getEmojiForType(type: ParticleType): string {
    switch (type) {
      case 'heart': return '❤️';
      case 'like': return '👍';
      case 'repost': return '🔁';
      case 'sparkle': return '✨';
      case 'confetti': return '🎉';
      case 'emoji': return '😊';
      default: return '✨';
    }
  }

  private getFromPool(emoji: string): THREE.Sprite | null {
    // Reuse existing sprite from pool
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].visible) {
        // Update texture if emoji changed
        const mat = this.pool[i].material as THREE.SpriteMaterial;
        if (mat.map) {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d')!;
          ctx.font = '96px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, 64, 64);
          
          // Dispose old texture
          mat.map.dispose();
          mat.map = new THREE.CanvasTexture(canvas);
          mat.map.minFilter = THREE.LinearFilter;
          mat.map.magFilter = THREE.LinearFilter;
        }
        return this.pool[i];
      }
    }
    
    // Pool exhausted, create new one (but limit pool size to prevent memory issues)
    if (this.pool.length < 100) {
      const sprite = this.createSprite(emoji);
      this.scene.add(sprite);
      this.pool.push(sprite);
      return sprite;
    }
    
    // Pool at max size, reuse oldest visible sprite
    return this.pool[0] || null;
  }

  tick(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      p.lifetime += dt;
      
      // Update position
      p.sprite.position.add(p.velocity.clone().multiplyScalar(dt));
      
      // FIX #4: AGGRESSIVE gravity for faster descent
      p.velocity.y -= 2.5 * dt;  // Increased from 1.2 to 2.5 for much faster fall
      
      // FIX #4: IMMEDIATE removal if too close to camera (within 30cm)
      // This prevents emojis from getting stuck in user's face
      if (p.sprite.position.z > -0.3) {
        p.sprite.visible = false;
        this.particles.splice(i, 1);
        continue; // Skip to next particle
      }
      
      // FIX #4: Also remove if particle drifts too far away (beyond 5m)
      const distFromOrigin = p.sprite.position.length();
      if (distFromOrigin > 5.0) {
        p.sprite.visible = false;
        this.particles.splice(i, 1);
        continue;
      }
      
      // Rotation
      p.rotation += p.rotationSpeed * dt;
      p.sprite.material.rotation = p.rotation;
      
      // Fade out
      const lifeRatio = p.lifetime / p.maxLifetime;
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 1 - lifeRatio;
      
      // Scale animation (pop in, then shrink)
      if (lifeRatio < 0.2) {
        const scale = lifeRatio / 0.2 * 0.08;
        p.sprite.scale.set(scale, scale, 1);
      } else {
        const scale = (1 - (lifeRatio - 0.2) / 0.8) * 0.08;
        p.sprite.scale.set(scale, scale, 1);
      }
      
      // FIX: Immediately hide and remove particles that are too close to camera
      // This prevents particles from getting stuck in user's POV
      if (p.sprite.position.z > -0.1) {  // Less than 10cm in front of camera
        p.sprite.visible = false;
        this.particles.splice(i, 1);
        continue;
      }
      
      // Remove expired particles
      if (p.lifetime >= p.maxLifetime) {
        p.sprite.visible = false;
        this.particles.splice(i, 1);
      }
    }
  }

  clear() {
    this.particles.forEach(p => {
      p.sprite.visible = false;
    });
    this.particles = [];
  }
}



