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
      fontFamily: '/fonts/Roboto-msdf.json',
      fontTexture: '/fonts/Roboto-msdf.png',
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
   * Update panel to face camera
   */
  update(camera: THREE.Camera): void {
    if (!this.panel || !this.visible) return;
    
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    
    // Face camera
    this.panel.lookAt(camPos);
    
    // Update ThreeMeshUI
    ThreeMeshUI.update();
  }
  
  /**
   * Raycast to check if hand is pointing at buttons
   */
  raycast(ray: THREE.Ray): { button: ButtonType } | null {
    if (!this.panel || !this.visible) return null;
    
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(ray);
    
    // Check host button
    if (this.hostButton?.visible) {
      const intersects = raycaster.intersectObject(this.hostButton as any, true);
      if (intersects.length > 0) {
        return { button: 'host' };
      }
    }
    
    // Check join button
    if (this.joinButton?.visible) {
      const intersects = raycaster.intersectObject(this.joinButton as any, true);
      if (intersects.length > 0) {
        return { button: 'join' };
      }
    }
    
    // Check accept button
    if (this.acceptButton?.visible) {
      const intersects = raycaster.intersectObject(this.acceptButton as any, true);
      if (intersects.length > 0) {
        return { button: 'accept' };
      }
    }
    
    // Check close button
    if (this.closeButton?.visible) {
      const intersects = raycaster.intersectObject(this.closeButton as any, true);
      if (intersects.length > 0) {
        return { button: 'close' };
      }
    }
    
    return null;
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
        this.codeDisplay.set({ content: `Code: ${shortCode}` });
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
      this.codeDisplay.set({
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
        this.codeDisplay.set({ content: `Answer: ${shortCode}` });
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
      this.statusText.set({ content: message });
    }
  }
  
  /**
   * Set button hover state (for visual feedback)
   */
  setButtonHover(button: ButtonType | null): void {
    // Reset all buttons to normal
    this.resetButtonColors();
    
    if (!button) return;
    
    // Highlight hovered button
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
    
    if (hoveredBlock) {
      hoveredBlock.set({
        backgroundOpacity: 0.8, // Slightly transparent when hovered
      });
    }
    
    this.hoveredButton = button;
  }
  
  private resetButtonColors(): void {
    if (this.hostButton) this.hostButton.set({ backgroundOpacity: 1 });
    if (this.joinButton) this.joinButton.set({ backgroundOpacity: 1 });
    if (this.acceptButton) this.acceptButton.set({ backgroundOpacity: 1 });
    if (this.closeButton) this.closeButton.set({ backgroundOpacity: 1 });
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
  }
}

