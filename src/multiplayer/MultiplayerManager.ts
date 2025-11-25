/**
 * MultiplayerManager - Real-time multiplayer for HoloreelXR
 * Enables two users to share hand gestures, emoji reactions, and 3D model transforms
 * 
 * Uses WebRTC for peer-to-peer real-time communication
 */

import { logError } from '../utils/errors';

export interface HandState {
  left: {
    position: { x: number; y: number; z: number } | null;
    rotation: { x: number; y: number; z: number; w: number } | null;
    pinching: boolean;
  };
  right: {
    position: { x: number; y: number; z: number } | null;
    rotation: { x: number; y: number; z: number; w: number } | null;
    pinching: boolean;
  };
}

export interface GestureEvent {
  type: 'like' | 'heart' | 'repost';
  timestamp: number;
  position: { x: number; y: number; z: number };
}

export interface TransformEvent {
  type: 'scale' | 'rotate' | 'place';
  modelId: string;
  scale?: number;
  rotation?: number;
  position?: { x: number; y: number; z: number };
  timestamp: number;
}

type MessageType = 
  | { type: 'hands'; data: HandState }
  | { type: 'gesture'; data: GestureEvent }
  | { type: 'transform'; data: TransformEvent }
  | { type: 'ping'; timestamp: number };

export class MultiplayerManager {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isHost = false;
  private connected = false;
  
  // Callbacks
  private onRemoteHandsCallback?: (hands: HandState) => void;
  private onRemoteGestureCallback?: (gesture: GestureEvent) => void;
  private onRemoteTransformCallback?: (transform: TransformEvent) => void;
  private onConnectionChangeCallback?: (connected: boolean) => void;
  
  // Throttling for hand updates (send max 20 times per second)
  private lastHandUpdateTime = 0;
  private readonly HAND_UPDATE_INTERVAL = 50; // 50ms = 20 FPS
  
  // Connection stats
  private latency = 0;
  private lastPingTime = 0;
  
  constructor() {
    console.log('[Multiplayer] 🎮 Initializing MultiplayerManager');
  }
  
  /**
   * Create a new multiplayer session as HOST
   * Returns an offer SDP that should be sent to the guest
   */
  async createSession(): Promise<string> {
    console.log('[Multiplayer] 🏠 Creating session as HOST');
    this.isHost = true;
    
    // Create peer connection with Google's public STUN server
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    // Create data channel for game data
    this.dataChannel = this.peerConnection.createDataChannel('holoreelxr', {
      ordered: false, // Faster, don't wait for lost packets
      maxRetransmits: 0
    });
    
    this.setupDataChannel(this.dataChannel);
    this.setupPeerConnection(this.peerConnection);
    
    // Create offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    // Wait for ICE gathering to complete
    await this.waitForICEGathering(this.peerConnection);
    
    const offerSDP = JSON.stringify(this.peerConnection.localDescription);
    console.log('[Multiplayer] ✅ Session created. Share this offer with guest.');
    
    return offerSDP;
  }
  
  /**
   * Join an existing session as GUEST
   * Takes the host's offer and returns an answer
   */
  async joinSession(offerSDP: string): Promise<string> {
    console.log('[Multiplayer] 🎮 Joining session as GUEST');
    this.isHost = false;
    
    // Create peer connection
    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    this.setupPeerConnection(this.peerConnection);
    
    // Set remote description (host's offer)
    const offer = JSON.parse(offerSDP);
    await this.peerConnection.setRemoteDescription(offer);
    
    // Create answer
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    
    // Wait for ICE gathering
    await this.waitForICEGathering(this.peerConnection);
    
    const answerSDP = JSON.stringify(this.peerConnection.localDescription);
    console.log('[Multiplayer] ✅ Answer created. Send this back to host.');
    
    return answerSDP;
  }
  
  /**
   * HOST: Receive answer from guest to complete connection
   */
  async receiveAnswer(answerSDP: string): Promise<void> {
    if (!this.peerConnection || !this.isHost) {
      throw new Error('Must be host to receive answer');
    }
    
    const answer = JSON.parse(answerSDP);
    await this.peerConnection.setRemoteDescription(answer);
    console.log('[Multiplayer] ✅ Answer received. Connection should establish soon.');
  }
  
  /**
   * Wait for ICE gathering to complete
   */
  private waitForICEGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
      } else {
        const checkState = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', checkState);
      }
    });
  }
  
  /**
   * Setup peer connection event handlers
   */
  private setupPeerConnection(pc: RTCPeerConnection): void {
    pc.addEventListener('connectionstatechange', () => {
      console.log('[Multiplayer] Connection state:', pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        this.connected = true;
        this.onConnectionChangeCallback?.(true);
        console.log('[Multiplayer] 🎉 CONNECTED! Real-time multiplayer active!');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.connected = false;
        this.onConnectionChangeCallback?.(false);
        console.log('[Multiplayer] ❌ Disconnected');
      }
    });
    
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        console.log('[Multiplayer] ICE candidate:', event.candidate.candidate);
      }
    });
    
    // Guest receives data channel from host
    pc.addEventListener('datachannel', (event) => {
      console.log('[Multiplayer] Data channel received');
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    });
  }
  
  /**
   * Setup data channel for game data
   */
  private setupDataChannel(dc: RTCDataChannel): void {
    dc.addEventListener('open', () => {
      console.log('[Multiplayer] 📡 Data channel OPEN - ready to sync!');
      this.connected = true;
      this.onConnectionChangeCallback?.(true);
      
      // Start ping loop
      this.startPingLoop();
    });
    
    dc.addEventListener('close', () => {
      console.log('[Multiplayer] 📡 Data channel closed');
      this.connected = false;
      this.onConnectionChangeCallback?.(false);
    });
    
    dc.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    
    dc.addEventListener('error', (error) => {
      console.error('[Multiplayer] Data channel error:', error);
      logError(error, 'Multiplayer data channel');
    });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message: MessageType = JSON.parse(data);
      
      switch (message.type) {
        case 'hands':
          this.onRemoteHandsCallback?.(message.data);
          break;
        case 'gesture':
          this.onRemoteGestureCallback?.(message.data);
          break;
        case 'transform':
          this.onRemoteTransformCallback?.(message.data);
          break;
        case 'ping':
          // Respond with pong
          this.sendMessage({ type: 'ping', timestamp: message.timestamp });
          break;
      }
    } catch (error) {
      logError(error, 'Multiplayer message handling');
    }
  }
  
  /**
   * Send message to peer
   */
  private sendMessage(message: MessageType): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return;
    }
    
    try {
      this.dataChannel.send(JSON.stringify(message));
    } catch (error) {
      // Silently fail if buffer is full
    }
  }
  
  /**
   * Broadcast hand positions (throttled)
   */
  broadcastHands(hands: HandState): void {
    const now = performance.now();
    if (now - this.lastHandUpdateTime < this.HAND_UPDATE_INTERVAL) {
      return; // Throttle updates
    }
    
    this.lastHandUpdateTime = now;
    this.sendMessage({ type: 'hands', data: hands });
  }
  
  /**
   * Broadcast gesture event
   */
  broadcastGesture(gesture: GestureEvent): void {
    this.sendMessage({ type: 'gesture', data: gesture });
    console.log('[Multiplayer] 📤 Sent gesture:', gesture.type);
  }
  
  /**
   * Broadcast transform event
   */
  broadcastTransform(transform: TransformEvent): void {
    this.sendMessage({ type: 'transform', data: transform });
    console.log('[Multiplayer] 📤 Sent transform:', transform.type);
  }
  
  /**
   * Start ping loop to measure latency
   */
  private startPingLoop(): void {
    setInterval(() => {
      if (this.connected) {
        const now = performance.now();
        this.sendMessage({ type: 'ping', timestamp: now });
        
        // Calculate latency if we got a response
        if (this.lastPingTime > 0) {
          this.latency = now - this.lastPingTime;
        }
        this.lastPingTime = now;
      }
    }, 1000); // Ping every second
  }
  
  /**
   * Register callbacks
   */
  onRemoteHands(callback: (hands: HandState) => void): void {
    this.onRemoteHandsCallback = callback;
  }
  
  onRemoteGesture(callback: (gesture: GestureEvent) => void): void {
    this.onRemoteGestureCallback = callback;
  }
  
  onRemoteTransform(callback: (transform: TransformEvent) => void): void {
    this.onRemoteTransformCallback = callback;
  }
  
  onConnectionChange(callback: (connected: boolean) => void): void {
    this.onConnectionChangeCallback = callback;
  }
  
  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected;
  }
  
  /**
   * Get latency in ms
   */
  getLatency(): number {
    return this.latency;
  }
  
  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    console.log('[Multiplayer] Disconnecting...');
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    this.connected = false;
    this.onConnectionChangeCallback?.(false);
  }
}

