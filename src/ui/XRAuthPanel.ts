// src/ui/XRAuthPanel.ts
import * as THREE from 'three';
import { AuthManager, User } from '../auth/AuthManager';

export class XRAuthPanel {
  private group = new THREE.Group();
  private panel: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private manager: AuthManager;
  private visible = false;
  private onSignIn?: (user: User) => void;

  private readonly PANEL_W = 0.5;
  private readonly PANEL_H = 0.6;
  private readonly CANVAS_W = 1024;
  private readonly CANVAS_H = 1224;

  constructor(manager: AuthManager, scene: THREE.Scene) {
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

    this.manager.onAuthChange(() => this.redraw());
    this.redraw();
  }

  show(camera: THREE.Camera) {
    this.visible = true;
    this.group.visible = true;
    
    // Position 1.5m in front of camera
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    camera.getWorldPosition(pos);
    camera.getWorldDirection(dir);
    this.group.position.copy(pos.add(dir.multiplyScalar(1.5)));
    this.group.position.y += 0.3; // Slightly above center
    
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
  raycast(ray: THREE.Ray): { button?: 'google' | 'meta' | 'guest' | 'signout' } | null {
    if (!this.visible) return null;
    
    const intersect = new THREE.Raycaster(ray.origin, ray.direction)
      .intersectObject(this.panel)[0];
    
    if (!intersect) return null;

    const uv = intersect.uv!;
    const x = uv.x * this.CANVAS_W;
    const y = (1 - uv.y) * this.CANVAS_H;

    // Button regions (from redraw layout)
    const btnH = 80;
    const btnY1 = 400; // Google
    const btnY2 = 500; // Meta
    const btnY3 = 600; // Guest
    const btnY4 = 700; // Sign out (if signed in)
    const btnW = this.CANVAS_W - 100;
    const btnX = 50;

    if (x >= btnX && x <= btnX + btnW) {
      if (y >= btnY1 && y <= btnY1 + btnH) return { button: 'google' };
      if (y >= btnY2 && y <= btnY2 + btnH) return { button: 'meta' };
      if (y >= btnY3 && y <= btnY3 + btnH) return { button: 'guest' };
      if (this.manager.getCurrentUser() && y >= btnY4 && y <= btnY4 + btnH) {
        return { button: 'signout' };
      }
    }
    return null;
  }

  handleClick(button: 'google' | 'meta' | 'guest' | 'signout') {
    if (button === 'google') {
      this.manager.signInWithGoogle().then(u => {
        if (this.onSignIn) this.onSignIn(u);
        this.hide();
      });
    } else if (button === 'meta') {
      this.manager.signInWithMeta().then(u => {
        if (this.onSignIn) this.onSignIn(u);
        this.hide();
      });
    } else if (button === 'guest') {
      const u = this.manager.signInAsGuest();
      if (this.onSignIn) this.onSignIn(u);
      this.hide();
    } else if (button === 'signout') {
      this.manager.signOut();
    }
  }

  setOnSignIn(callback: (user: User) => void) {
    this.onSignIn = callback;
  }

  private redraw() {
    const c = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);

    const user = this.manager.getCurrentUser();
    
    if (user) {
      // Signed in view
      ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
      ctx.fillRect(0, 0, c.width, c.height);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Signed In', c.width / 2, 100);
      
      ctx.font = '32px sans-serif';
      ctx.fillText(user.name, c.width / 2, 200);
      ctx.fillText(user.provider === 'guest' ? 'Guest' : user.provider, c.width / 2, 250);
      
      if (user.email) {
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#aaa';
        ctx.fillText(user.email, c.width / 2, 300);
      }
      
      // Sign out button
      ctx.fillStyle = '#f44336';
      ctx.fillRect(50, 700, c.width - 100, 80);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('Sign Out', c.width / 2, 750);
    } else {
      // Sign in view
      ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
      ctx.fillRect(0, 0, c.width, c.height);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sign In', c.width / 2, 100);
      
      // Google button
      ctx.fillStyle = '#4285F4';
      ctx.fillRect(50, 400, c.width - 100, 80);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('Sign in with Google', c.width / 2, 450);
      
      // Meta button
      ctx.fillStyle = '#0081FB';
      ctx.fillRect(50, 500, c.width - 100, 80);
      ctx.fillStyle = '#fff';
      ctx.fillText('Sign in with Meta', c.width / 2, 550);
      
      // Guest button
      ctx.fillStyle = '#666';
      ctx.fillRect(50, 600, c.width - 100, 80);
      ctx.fillStyle = '#fff';
      ctx.fillText('Continue as Guest', c.width / 2, 650);
    }

    this.texture.needsUpdate = true;
  }

  update(camera: THREE.Camera) {
    if (this.visible) {
      // Keep facing camera
      this.group.lookAt(camera.position);
    }
  }
}

