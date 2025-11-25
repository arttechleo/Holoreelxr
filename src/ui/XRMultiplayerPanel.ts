/**
 * XRMultiplayerPanel - 3D interactive panel for multiplayer in XR space
 * Hand gesture based - no keyboard needed!
 */

import * as THREE from 'three';
import ThreeMeshUI from 'three-mesh-ui';
import { MultiplayerManager } from '../multiplayer/MultiplayerManager';

type ButtonType = 'host' | 'join' | 'close' | 'copy' | 'accept';

export class XRMultiplayerPanel {
  private panel: ThreeMeshUI.Block | null = null;
  private scene: THREE.Scene;
  private multiplayer: MultiplayerManager;
  private visible = false;
  
  // UI Elements
  private statusText: ThreeMeshUI.Text | null = null;
  private hostButton: ThreeMeshUI.Block | null = null;
  private joinButton: ThreeMeshUI.Block | null = null;
  private acceptButton: ThreeMeshUI.Block | null = null;
  private closeButton: ThreeMeshUI.Block | null = null;
  private codeDisplay: ThreeMeshUI.Text | null = null;
  
  // CRITICAL: Invisible hitboxes for raycasting (ThreeMeshUI doesn't raycast well)
  private hostHitbox: THREE.Mesh | null = null;
  private joinHitbox: THREE.Mesh | null = null;
  private acceptHitbox: THREE.Mesh | null = null;
  private closeHitbox: THREE.Mesh | null = null;
  
  // State
  private currentCode = '';
  private mode: 'idle' | 'hosting' | 'joining' | 'waiting' = 'idle';
  private hoveredButton: ButtonType | null = null;
  
  // Callbacks
  private onConnectionCallback?: (connected: boolean) => void;
  
  constructor(scene: THREE.Scene, multiplayer: MultiplayerManager) {
    this.scene = scene;
    this.multiplayer = multiplayer;
    this.createPanel();
    console.log('[XRMultiplayerPanel] 🎮 3D multiplayer panel created');
  }
  
  private createPanel(): void {
    // Main container
    this.panel = new ThreeMeshUI.Block({
      width: 0.6,
      height: 0.5,
      padding: 0.03,
      backgroundOpacity: 0.95,
      backgroundColor: new THREE.Color(0x0a0a0a),
      borderRadius: 0.02,
      justifyContent: 'start',
      flexDirection: 'column',
      // CRITICAL FIX: Don't specify fonts - ThreeMeshUI will use built-in defaults
    });
    
    this.panel.position.set(0, 1.4, -0.8);
    this.panel.rotation.x = -0.2;
    this.panel.visible = false;
    this.scene.add(this.panel);
    
    // Title
    const title = new ThreeMeshUI.Text({
      content: '🎮 MULTIPLAYER',
      fontSize: 0.05,
      fontColor: new THREE.Color(0x4ECDC4),
    });
    this.panel.add(title);
    
    // Status text
    this.statusText = new ThreeMeshUI.Text({
      content: 'Join a friend in XR!',
      fontSize: 0.03,
      fontColor: new THREE.Color(0xeeeeee),
    });
    this.panel.add(this.statusText);
    
    // Spacer
    this.panel.add(new ThreeMeshUI.Block({
      width: 0.5,
      height: 0.02,
      backgroundColor: new THREE.Color(0x000000),
      backgroundOpacity: 0,
    }));
    
    // Host button
    this.hostButton = this.createButton('🏠 HOST SESSION', 0x667eea);
    this.panel.add(this.hostButton);
    
    // Join button
    this.joinButton = this.createButton('🎮 JOIN SESSION', 0xf5576c);
    this.panel.add(this.joinButton);
    
    // Code display (hidden initially)
    this.codeDisplay = new ThreeMeshUI.Text({
      content: '',
      fontSize: 0.025,
      fontColor: new THREE.Color(0x4ECDC4),
    });
    this.codeDisplay.visible = false;
    this.panel.add(this.codeDisplay);
    
    // Accept button (for guest to complete connection)
    this.acceptButton = this.createButton('✅ I SHARED THE CODE', 0x27ae60);
    this.acceptButton.visible = false;
    this.panel.add(this.acceptButton);
    
    // Spacer
    this.panel.add(new ThreeMeshUI.Block({
      width: 0.5,
      height: 0.02,
      backgroundColor: new THREE.Color(0x000000),
      backgroundOpacity: 0,
    }));
    
    // Close button
    this.closeButton = this.createButton('✕ CLOSE', 0x666666);
    this.panel.add(this.closeButton);
    
    // CRITICAL: Create invisible hitboxes for raycasting
    this.hostHitbox = this.createHitbox(0.5, 0.08);
    this.scene.add(this.hostHitbox);
    
    this.joinHitbox = this.createHitbox(0.5, 0.08);
    this.scene.add(this.joinHitbox);
    
    this.acceptHitbox = this.createHitbox(0.5, 0.08);
    this.scene.add(this.acceptHitbox);
    
    this.closeHitbox = this.createHitbox(0.5, 0.08);
    this.scene.add(this.closeHitbox);
  }
  
  private createButton(text: string, color: number): ThreeMeshUI.Block {
    const button = new ThreeMeshUI.Block({
      width: 0.5,
      height: 0.08,
      margin: 0.01,
      padding: 0.02,
      backgroundColor: new THREE.Color(color),
      backgroundOpacity: 1,
      borderRadius: 0.02,
      justifyContent: 'center',
      alignItems: 'center',
    });
    
    const buttonText = new ThreeMeshUI.Text({
      content: text,
      fontSize: 0.03,
      fontColor: new THREE.Color(0xffffff),
    });
    
    button.add(buttonText);
    return button;
  }
  
  /**
   * Create invisible hitbox for raycasting
   * CRITICAL: ThreeMeshUI doesn't raycast well, so we need real THREE.Mesh hitboxes
   */
  private createHitbox(width: number, height: number): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0, // Invisible
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'button-hitbox';
    return mesh;
  }
  
  /**
   * Update hitbox positions to match buttons
   * CRITICAL: Must be called after ThreeMeshUI updates positions
   */
  private updateHitboxes(): void {
    if (!this.panel) return;
    
    // Update panel's world matrix
    this.panel.updateWorldMatrix(true, true);
    
    // Host button hitbox
    if (this.hostButton && this.hostHitbox) {
      const pos = new THREE.Vector3();
      this.hostButton.getWorldPosition(pos);
      this.hostHitbox.position.copy(pos);
      this.hostHitbox.quaternion.copy(this.panel.quaternion);
      this.hostHitbox.visible = this.hostButton.visible;
    }
    
    // Join button hitbox
    if (this.joinButton && this.joinHitbox) {
      const pos = new THREE.Vector3();
      this.joinButton.getWorldPosition(pos);
      this.joinHitbox.position.copy(pos);
      this.joinHitbox.quaternion.copy(this.panel.quaternion);
      this.joinHitbox.visible = this.joinButton.visible;
    }
    
    // Accept button hitbox
    if (this.acceptButton && this.acceptHitbox) {
      const pos = new THREE.Vector3();
      this.acceptButton.getWorldPosition(pos);
      this.acceptHitbox.position.copy(pos);
      this.acceptHitbox.quaternion.copy(this.panel.quaternion);
      this.acceptHitbox.visible = this.acceptButton.visible;
    }
    
    // Close button hitbox
    if (this.closeButton && this.closeHitbox) {
      const pos = new THREE.Vector3();
      this.closeButton.getWorldPosition(pos);
      this.closeHitbox.position.copy(pos);
      this.closeHitbox.quaternion.copy(this.panel.quaternion);
      this.closeHitbox.visible = this.closeButton.visible;
    }
  }
  
  /**
   * Update panel to face camera
   * CRITICAL: Also updates hitbox positions every frame
   */
  update(camera: THREE.Camera): void {
    if (!this.panel || !this.visible) return;
    
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    
    // Face camera
    this.panel.lookAt(camPos);
    
    // Update ThreeMeshUI (this updates button positions)
    ThreeMeshUI.update();
    
    // CRITICAL: Update hitboxes to match button positions
    this.updateHitboxes();
  }
  
  /**
   * Raycast to check if hand is pointing at buttons
   * CRITICAL: Uses invisible hitboxes for accurate raycasting
   */
  raycast(ray: THREE.Ray): { button: ButtonType; distance: number } | null {
    if (!this.panel || !this.visible) return null;
    
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(ray);
    
    let closestHit: { button: ButtonType; distance: number } | null = null;
    let minDistance = Infinity;
    
    // Check host button hitbox
    if (this.hostHitbox && this.hostHitbox.visible) {
      const intersects = raycaster.intersectObject(this.hostHitbox, false);
      if (intersects.length > 0 && intersects[0].distance < minDistance) {
        minDistance = intersects[0].distance;
        closestHit = { button: 'host', distance: intersects[0].distance };
      }
    }
    
    // Check join button hitbox
    if (this.joinHitbox && this.joinHitbox.visible) {
      const intersects = raycaster.intersectObject(this.joinHitbox, false);
      if (intersects.length > 0 && intersects[0].distance < minDistance) {
        minDistance = intersects[0].distance;
        closestHit = { button: 'join', distance: intersects[0].distance };
      }
    }
    
    // Check accept button hitbox
    if (this.acceptHitbox && this.acceptHitbox.visible) {
      const intersects = raycaster.intersectObject(this.acceptHitbox, false);
      if (intersects.length > 0 && intersects[0].distance < minDistance) {
        minDistance = intersects[0].distance;
        closestHit = { button: 'accept', distance: intersects[0].distance };
      }
    }
    
    // Check close button hitbox
    if (this.closeHitbox && this.closeHitbox.visible) {
      const intersects = raycaster.intersectObject(this.closeHitbox, false);
      if (intersects.length > 0 && intersects[0].distance < minDistance) {
        minDistance = intersects[0].distance;
        closestHit = { button: 'close', distance: intersects[0].distance };
      }
    }
    
    return closestHit;
  }
  
  /**
   * Handle button clicks with hand pinch
   */
  async handleClick(button: ButtonType): Promise<void> {
    console.log('[XRMultiplayerPanel] Button clicked:', button);
    
    switch (button) {
      case 'host':
        await this.handleHost();
        break;
      case 'join':
        await this.handleJoin();
        break;
      case 'accept':
        this.handleAccept();
        break;
      case 'close':
        this.hide();
        break;
    }
  }
  
  /**
   * Handle host session creation
   */
  private async handleHost(): Promise<void> {
    this.mode = 'hosting';
    this.updateStatus('Creating session...');
    
    try {
      const offer = await this.multiplayer.createSession();
      this.currentCode = offer;
      
      // Show simplified code (just first/last chars for display)
      const shortCode = `${offer.substring(0, 20)}...${offer.substring(offer.length - 20)}`;
      
      this.updateStatus('📤 Share code with friend!');
      
      if (this.codeDisplay) {
        (this.codeDisplay as any).set({ content: `Code: ${shortCode}` });
        this.codeDisplay.visible = true;
      }
      
      // Hide host/join buttons, show close
      if (this.hostButton) this.hostButton.visible = false;
      if (this.joinButton) this.joinButton.visible = false;
      
      // Auto-copy to clipboard (if available)
      if (navigator.clipboard) {
        navigator.clipboard.writeText(offer).then(() => {
          console.log('[XRMultiplayerPanel] Code copied to clipboard');
        });
      }
      
      console.log('[XRMultiplayerPanel] HOST CODE:', offer);
      this.updateStatus('📱 Code copied! Share with friend via phone/desktop');
      
    } catch (error) {
      this.updateStatus('❌ Failed to create session');
      console.error('[XRMultiplayerPanel] Host error:', error);
    }
  }
  
  /**
   * Handle join session (guest side)
   */
  private async handleJoin(): Promise<void> {
    this.mode = 'joining';
    this.updateStatus('📥 Waiting for host code...');
    
    // In XR, user must paste code via phone/desktop
    // For now, we'll show instructions
    if (this.codeDisplay) {
      (this.codeDisplay as any).set({
        content: 'Paste host code on phone/desktop browser at:\nholoreelxr.com/connect'
      });
      this.codeDisplay.visible = true;
    }
    
    if (this.hostButton) this.hostButton.visible = false;
    if (this.joinButton) this.joinButton.visible = false;
    
    // TODO: Show QR code or pairing code for easy phone connection
  }
  
  /**
   * Handle accept button (guest confirms code shared)
   */
  private handleAccept(): void {
    this.updateStatus('✅ Waiting for connection...');
    if (this.acceptButton) this.acceptButton.visible = false;
  }
  
  /**
   * External method: Guest received host code and generated answer
   */
  async processGuestAnswer(hostCode: string): Promise<string> {
    try {
      const answer = await this.multiplayer.joinSession(hostCode);
      
      if (this.codeDisplay) {
        const shortCode = `${answer.substring(0, 20)}...${answer.substring(answer.length - 20)}`;
        (this.codeDisplay as any).set({ content: `Answer: ${shortCode}` });
      }
      
      this.updateStatus('📤 Share answer back to host!');
      
      if (this.acceptButton) {
        this.acceptButton.visible = true;
      }
      
      // Copy to clipboard
      if (navigator.clipboard) {
        navigator.clipboard.writeText(answer);
      }
      
      console.log('[XRMultiplayerPanel] GUEST ANSWER:', answer);
      return answer;
      
    } catch (error) {
      this.updateStatus('❌ Failed to join');
      console.error('[XRMultiplayerPanel] Join error:', error);
      throw error;
    }
  }
  
  /**
   * External method: Host received answer from guest
   */
  async processHostAnswer(answer: string): Promise<void> {
    try {
      await this.multiplayer.receiveAnswer(answer);
      this.updateStatus('✅ Connecting...');
    } catch (error) {
      this.updateStatus('❌ Invalid answer');
      console.error('[XRMultiplayerPanel] Answer error:', error);
    }
  }
  
  /**
   * Update status text
   */
  private updateStatus(message: string): void {
    if (this.statusText) {
      (this.statusText as any).set({ content: message });
    }
  }
  
  /**
   * Set button hover state (for visual feedback)
   * CRITICAL: Makes buttons glow/scale when pointed at
   */
  setButtonHover(button: ButtonType | null): void {
    // Don't do anything if hover state hasn't changed
    if (this.hoveredButton === button) return;
    
    // Reset all buttons to normal
    this.resetButtonColors();
    
    if (!button) {
      this.hoveredButton = null;
      return;
    }
    
    // Highlight hovered button with scale and opacity
    let hoveredBlock: ThreeMeshUI.Block | null = null;
    
    switch (button) {
      case 'host':
        hoveredBlock = this.hostButton;
        break;
      case 'join':
        hoveredBlock = this.joinButton;
        break;
      case 'accept':
        hoveredBlock = this.acceptButton;
        break;
      case 'close':
        hoveredBlock = this.closeButton;
        break;
    }
    
    if (hoveredBlock && hoveredBlock.visible) {
      // Make button slightly larger and brighter when hovered
      (hoveredBlock as any).set({
        backgroundOpacity: 0.9,
      });
      
      // Scale effect (subtle pulsing)
      if ((hoveredBlock as any).scale) {
        (hoveredBlock as any).scale.set(1.05, 1.05, 1.05);
      }
      
      console.log('[XRMultiplayerPanel] 👆 Hovering:', button);
    }
    
    this.hoveredButton = button;
  }
  
  private resetButtonColors(): void {
    if (this.hostButton) {
      (this.hostButton as any).set({ backgroundOpacity: 1 });
      if ((this.hostButton as any).scale) {
        (this.hostButton as any).scale.set(1, 1, 1);
      }
    }
    if (this.joinButton) {
      (this.joinButton as any).set({ backgroundOpacity: 1 });
      if ((this.joinButton as any).scale) {
        (this.joinButton as any).scale.set(1, 1, 1);
      }
    }
    if (this.acceptButton) {
      (this.acceptButton as any).set({ backgroundOpacity: 1 });
      if ((this.acceptButton as any).scale) {
        (this.acceptButton as any).scale.set(1, 1, 1);
      }
    }
    if (this.closeButton) {
      (this.closeButton as any).set({ backgroundOpacity: 1 });
      if ((this.closeButton as any).scale) {
        (this.closeButton as any).scale.set(1, 1, 1);
      }
    }
  }
  
  /**
   * Show/hide panel
   */
  show(): void {
    if (this.panel) {
      this.panel.visible = true;
      this.visible = true;
      
      // Reset to idle state
      this.mode = 'idle';
      if (this.hostButton) this.hostButton.visible = true;
      if (this.joinButton) this.joinButton.visible = true;
      if (this.acceptButton) this.acceptButton.visible = false;
      if (this.codeDisplay) this.codeDisplay.visible = false;
      this.updateStatus('Join a friend in XR!');
    }
  }
  
  hide(): void {
    if (this.panel) {
      this.panel.visible = false;
      this.visible = false;
    }
  }
  
  isVisible(): boolean {
    return this.visible;
  }
  
  /**
   * Connection status changed
   */
  onConnectionChange(connected: boolean): void {
    if (connected) {
      this.updateStatus('🎉 CONNECTED! Have fun!');
      setTimeout(() => this.hide(), 3000);
    } else {
      this.updateStatus('❌ Disconnected');
    }
    
    this.onConnectionCallback?.(connected);
  }
  
  /**
   * Register callback
   */
  onConnection(callback: (connected: boolean) => void): void {
    this.onConnectionCallback = callback;
  }
  
  /**
   * Dispose
   */
  dispose(): void {
    if (this.panel) {
      this.scene.remove(this.panel);
    }
    
    // Dispose hitboxes
    if (this.hostHitbox) {
      this.hostHitbox.geometry.dispose();
      (this.hostHitbox.material as THREE.Material).dispose();
      this.scene.remove(this.hostHitbox);
    }
    if (this.joinHitbox) {
      this.joinHitbox.geometry.dispose();
      (this.joinHitbox.material as THREE.Material).dispose();
      this.scene.remove(this.joinHitbox);
    }
    if (this.acceptHitbox) {
      this.acceptHitbox.geometry.dispose();
      (this.acceptHitbox.material as THREE.Material).dispose();
      this.scene.remove(this.acceptHitbox);
    }
    if (this.closeHitbox) {
      this.closeHitbox.geometry.dispose();
      (this.closeHitbox.material as THREE.Material).dispose();
      this.scene.remove(this.closeHitbox);
    }
  }
}

