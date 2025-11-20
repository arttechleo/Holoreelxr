// src/ui/XRMusicPanel.ts
import * as THREE from 'three';
import { MusicManager, Track } from '../music/MusicManager';

export class XRMusicPanel {
  private group = new THREE.Group();
  private panel: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private manager: MusicManager;
  private visible = false;

  private readonly PANEL_W = 0.5;
  private readonly PANEL_H = 0.6;
  private readonly CANVAS_W = 1024;
  private readonly CANVAS_H = 1224;

  constructor(manager: MusicManager, scene: THREE.Scene) {
    this.manager = manager;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.CANVAS_W;
    this.canvas.height = this.CANVAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 16;

    const geo = new THREE.PlaneGeometry(this.PANEL_W, this.PANEL_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    this.panel = new THREE.Mesh(geo, mat);
    this.group.add(this.panel);
    this.group.visible = false;
    scene.add(this.group);

    this.manager.onPlaybackChange(() => this.redraw());
    this.redraw();
  }

  show(camera: THREE.Camera) {
    this.visible = true;
    this.group.visible = true;
    
    // Position 1.5m in front of camera, to the right
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    camera.getWorldPosition(pos);
    camera.getWorldDirection(dir);
    camera.getWorldDirection(right);
    right.cross(camera.up || new THREE.Vector3(0, 1, 0));
    this.group.position.copy(pos.add(dir.multiplyScalar(1.5)).add(right.multiplyScalar(0.5)));
    this.group.position.y += 0.3;
    
    // Face camera
    this.group.lookAt(camera.position);
    this.redraw();
  }

  hide() {
    this.visible = false;
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  // Raycast hit test
  raycast(ray: THREE.Ray): { button?: 'spotify' | 'soundcloud' | 'play' | 'stop' } | null {
    if (!this.visible) return null;
    
    const intersect = new THREE.Raycaster(ray.origin, ray.direction)
      .intersectObject(this.panel)[0];
    
    if (!intersect) return null;

    const uv = intersect.uv!;
    const x = uv.x * this.CANVAS_W;
    const y = (1 - uv.y) * this.CANVAS_H;

    // Button regions
    const btnH = 80;
    const btnY1 = 400; // Spotify
    const btnY2 = 500; // SoundCloud
    const btnY3 = 600; // Play/Pause
    const btnY4 = 700; // Stop
    const btnW = this.CANVAS_W - 100;
    const btnX = 50;

    if (x >= btnX && x <= btnX + btnW) {
      if (y >= btnY1 && y <= btnY1 + btnH) return { button: 'spotify' };
      if (y >= btnY2 && y <= btnY2 + btnH) return { button: 'soundcloud' };
      if (y >= btnY3 && y <= btnY3 + btnH) return { button: 'play' };
      if (y >= btnY4 && y <= btnY4 + btnH) return { button: 'stop' };
    }
    return null;
  }

  handleClick(button: 'spotify' | 'soundcloud' | 'play' | 'stop') {
    if (button === 'spotify') {
      this.manager.signInSpotify();
    } else if (button === 'soundcloud') {
      this.manager.signInSoundCloud();
    } else if (button === 'play') {
      this.manager.togglePlayback();
    } else if (button === 'stop') {
      this.manager.stop();
    }
  }

  private redraw() {
    const c = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    const track = this.manager.getCurrentTrack();
    const playing = this.manager.isCurrentlyPlaying();
    
    ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    ctx.fillRect(0, 0, c.width, c.height);
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Music Player', c.width / 2, 100);
    
    if (track) {
      ctx.font = '32px sans-serif';
      ctx.fillText(track.title, c.width / 2, 200);
      ctx.font = '24px sans-serif';
      ctx.fillStyle = '#aaa';
      ctx.fillText(track.artist, c.width / 2, 250);
    } else {
      ctx.font = '24px sans-serif';
      ctx.fillStyle = '#888';
      ctx.fillText('No track playing', c.width / 2, 200);
    }
    
    // Spotify button
    ctx.fillStyle = '#1DB954';
    ctx.fillRect(50, 400, c.width - 100, 80);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('Sign in with Spotify', c.width / 2, 450);
    
    // SoundCloud button
    ctx.fillStyle = '#FF5500';
    ctx.fillRect(50, 500, c.width - 100, 80);
    ctx.fillStyle = '#fff';
    ctx.fillText('Sign in with SoundCloud', c.width / 2, 550);
    
    // Play/Pause button
    ctx.fillStyle = playing ? '#f44336' : '#4CAF50';
    ctx.fillRect(50, 600, c.width - 100, 80);
    ctx.fillStyle = '#fff';
    ctx.fillText(playing ? 'Pause' : 'Play', c.width / 2, 650);
    
    // Stop button
    ctx.fillStyle = '#666';
    ctx.fillRect(50, 700, c.width - 100, 80);
    ctx.fillStyle = '#fff';
    ctx.fillText('Stop', c.width / 2, 750);

    this.texture.needsUpdate = true;
  }

  update(camera: THREE.Camera) {
    if (this.visible) {
      this.group.lookAt(camera.position);
    }
  }
}

