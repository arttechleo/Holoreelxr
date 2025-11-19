/**
 * 🎬 TikTok-Style Feed UI for VR
 * 
 * Features:
 * - Smooth vertical scrolling with momentum
 * - Swipe gestures
 * - Auto-play indicators
 * - Progress bars
 * - Creator info panels
 * - View counts & engagement stats
 * - Trending indicators
 * - Smooth transitions
 */

import * as THREE from 'three';

interface FeedItemMeta {
  creator: string;
  avatar?: string;
  views: number;
  likes: number;
  comments: number;
  timestamp: Date;
  isTrending?: boolean;
  hashtags?: string[];
}

export class TikTokFeedUI {
  private group = new THREE.Group();
  
  // UI Panels
  private creatorPanel!: THREE.Mesh;
  private statsPanel!: THREE.Mesh;
  private progressBar!: THREE.Mesh;
  private trendingBadge!: THREE.Mesh;
  
  // Canvases
  private creatorCanvas: HTMLCanvasElement;
  private creatorTexture: THREE.CanvasTexture;
  private statsCanvas: HTMLCanvasElement;
  private statsTexture: THREE.CanvasTexture;
  
  // State
  private currentMeta: FeedItemMeta | null = null;
  private progress = 0; // 0-1 for progress bar
  
  constructor() {
    this.group.name = 'TikTokFeedUI';
    
    // Create canvases
    this.creatorCanvas = document.createElement('canvas');
    this.creatorCanvas.width = 512;
    this.creatorCanvas.height = 128;
    this.creatorTexture = new THREE.CanvasTexture(this.creatorCanvas);
    this.creatorTexture.minFilter = THREE.LinearFilter;
    this.creatorTexture.magFilter = THREE.LinearFilter;
    this.creatorTexture.anisotropy = 16;
    
    this.statsCanvas = document.createElement('canvas');
    this.statsCanvas.width = 256;
    this.statsCanvas.height = 512;
    this.statsTexture = new THREE.CanvasTexture(this.statsCanvas);
    this.statsTexture.minFilter = THREE.LinearFilter;
    this.statsTexture.magFilter = THREE.LinearFilter;
    this.statsTexture.anisotropy = 16;
    
    this.buildUI();
  }

  private buildUI() {
    // Creator panel (bottom left - shows creator info)
    const creatorGeo = new THREE.PlaneGeometry(0.35, 0.09);
    const creatorMat = new THREE.MeshBasicMaterial({
      map: this.creatorTexture,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.95,
    });
    this.creatorPanel = new THREE.Mesh(creatorGeo, creatorMat);
    this.creatorPanel.position.set(-0.25, -0.35, 0.02);
    this.group.add(this.creatorPanel);
    
    // Stats panel (right side - vertical stack of engagement stats)
    const statsGeo = new THREE.PlaneGeometry(0.08, 0.35);
    const statsMat = new THREE.MeshBasicMaterial({
      map: this.statsTexture,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.95,
    });
    this.statsPanel = new THREE.Mesh(statsGeo, statsMat);
    this.statsPanel.position.set(0.42, 0, 0.02);
    this.group.add(this.statsPanel);
    
    // Progress bar (top - shows viewing progress)
    const progressGeo = new THREE.PlaneGeometry(0.6, 0.006);
    const progressMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    this.progressBar = new THREE.Mesh(progressGeo, progressMat);
    this.progressBar.position.set(0, 0.45, 0.02);
    this.group.add(this.progressBar);
    
    // Trending badge (animated glow)
    const badgeGeo = new THREE.PlaneGeometry(0.08, 0.08);
    const badgeMat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0,
    });
    this.trendingBadge = new THREE.Mesh(badgeGeo, badgeMat);
    this.trendingBadge.position.set(-0.42, 0.38, 0.03);
    this.group.add(this.trendingBadge);
  }

  showForItem(meta: FeedItemMeta) {
    this.currentMeta = meta;
    this.progress = 0;
    this.updateCreatorPanel();
    this.updateStatsPanel();
    this.updateTrendingBadge();
  }

  private updateCreatorPanel() {
    if (!this.currentMeta) return;
    
    const ctx = this.creatorCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.creatorCanvas.width, this.creatorCanvas.height);
    
    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.roundRect(0, 0, this.creatorCanvas.width, this.creatorCanvas.height, 12);
    ctx.fill();
    
    // Creator name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`@${this.currentMeta.creator}`, 20, this.creatorCanvas.height / 2);
    
    // Hashtags
    if (this.currentMeta.hashtags && this.currentMeta.hashtags.length > 0) {
      ctx.font = '20px system-ui';
      ctx.fillStyle = '#88aaff';
      const hashtagText = this.currentMeta.hashtags.slice(0, 2).map(h => `#${h}`).join(' ');
      ctx.fillText(hashtagText, 20, this.creatorCanvas.height - 25);
    }
    
    this.creatorTexture.needsUpdate = true;
  }

  private updateStatsPanel() {
    if (!this.currentMeta) return;
    
    const ctx = this.statsCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.statsCanvas.width, this.statsCanvas.height);
    
    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.roundRect(0, 0, this.statsCanvas.width, this.statsCanvas.height, 12);
    ctx.fill();
    
    const stats = [
      { icon: '❤️', value: this.formatNumber(this.currentMeta.likes), y: 80 },
      { icon: '💬', value: this.formatNumber(this.currentMeta.comments), y: 200 },
      { icon: '👀', value: this.formatNumber(this.currentMeta.views), y: 320 },
      { icon: '🔗', value: 'Share', y: 440 },
    ];
    
    stats.forEach(stat => {
      // Icon
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stat.icon, this.statsCanvas.width / 2, stat.y);
      
      // Value
      ctx.font = 'bold 24px system-ui';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(stat.value, this.statsCanvas.width / 2, stat.y + 35);
    });
    
    this.statsTexture.needsUpdate = true;
  }

  private updateTrendingBadge() {
    if (!this.currentMeta) return;
    
    const mat = this.trendingBadge.material as THREE.MeshBasicMaterial;
    if (this.currentMeta.isTrending) {
      mat.opacity = 0.9;
      // Add pulsing animation in tick()
    } else {
      mat.opacity = 0;
    }
  }

  updateProgress(progress: number) {
    this.progress = Math.max(0, Math.min(1, progress));
    
    // Update progress bar scale
    this.progressBar.scale.x = this.progress;
    this.progressBar.position.x = -0.3 + (this.progress * 0.3);
  }

  tick(dt: number) {
    // Pulse trending badge
    if (this.currentMeta?.isTrending) {
      const mat = this.trendingBadge.material as THREE.MeshBasicMaterial;
      const pulse = Math.sin(Date.now() * 0.003) * 0.15 + 0.85;
      mat.opacity = pulse * 0.9;
      
      // Rotate badge slightly
      this.trendingBadge.rotation.z += dt * 0.5;
    }
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  show() {
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  // Smooth transitions
  fadeIn(duration: number = 0.3) {
    this.group.traverse((obj) => {
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
        const startOpacity = mat.opacity;
        const targetOpacity = 0.95;
        let elapsed = 0;
        
        const animate = () => {
          elapsed += 1/60; // Assume 60fps
          const t = Math.min(elapsed / duration, 1);
          mat.opacity = startOpacity + (targetOpacity - startOpacity) * t;
          
          if (t < 1) {
            requestAnimationFrame(animate);
          }
        };
        
        animate();
      }
    });
  }

  lookAt(target: THREE.Vector3) {
    this.group.lookAt(target);
  }

  setPosition(pos: THREE.Vector3) {
    this.group.position.copy(pos);
  }
}



