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
  private pingIntervalId: number | null = null; // CRITICAL: Store interval ID for cleanup
  
  constructor() {
    console.log('[Multiplayer] 🎮 Initializing MultiplayerManager');
  }
  
  /**
   * Create a new multiplayer session as HOST
   * Returns an offer SDP that should be sent to the guest
   * CRITICAL FIX: Cleanup old connection if exists
   */
  async createSession(): Promise<string> {
    console.log('[Multiplayer] Creating session as HOST');
    
    try {
      // CRITICAL: If already connected, disconnect first
      if (this.peerConnection || this.dataChannel) {
        console.warn('[Multiplayer] Existing connection found, cleaning up...');
        this.disconnect();
        // Wait a bit for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
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
        ordered: false,
        maxRetransmits: 0
      });
      
      this.setupDataChannel(this.dataChannel);
      this.setupPeerConnection(this.peerConnection);
      
      // Create offer with error handling
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      // Wait for ICE gathering (with timeout)
      await this.waitForICEGathering(this.peerConnection);
      
      if (!this.peerConnection.localDescription) {
        throw new Error('Failed to create local description');
      }
      
      const offerSDP = JSON.stringify(this.peerConnection.localDescription);
      console.log('[Multiplayer] Session created');
      
      return offerSDP;
    } catch (error) {
      console.error('[Multiplayer] Create session error:', error);
      // Cleanup on error
      this.disconnect();
      throw error;
    }
  }
  
  /**
   * Join an existing session as GUEST
   * Takes the host's offer and returns an answer
   * CRITICAL FIX: Cleanup old connection if exists
   */
  async joinSession(offerSDP: string): Promise<string> {
    console.log('[Multiplayer] 🎮 Joining session as GUEST');
    
    // CRITICAL: If already connected, disconnect first
    if (this.peerConnection || this.dataChannel) {
      console.warn('[Multiplayer] ⚠️ Existing connection found, cleaning up...');
      this.disconnect();
      // Wait a bit for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
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
    // CRITICAL: Validate and parse offer
    let offer: RTCSessionDescriptionInit;
    try {
      offer = JSON.parse(offerSDP);
      if (!offer || !offer.type || !offer.sdp) {
        throw new Error('Invalid offer structure');
      }
    } catch (error) {
      throw new Error(`Failed to parse offer: ${error}`);
    }
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
   * CRITICAL FIX: Validate answer before processing
   */
  async receiveAnswer(answerSDP: string): Promise<void> {
    if (!this.peerConnection || !this.isHost) {
      throw new Error('Must be host to receive answer');
    }
    
    // CRITICAL: Validate and parse answer
    if (!answerSDP || typeof answerSDP !== 'string') {
      throw new Error('Invalid answer SDP');
    }
    
    let answer: RTCSessionDescriptionInit;
    try {
      answer = JSON.parse(answerSDP);
      if (!answer || !answer.type || !answer.sdp) {
        throw new Error('Invalid answer structure');
      }
    } catch (error) {
      throw new Error(`Failed to parse answer: ${error}`);
    }
    
    await this.peerConnection.setRemoteDescription(answer);
    console.log('[Multiplayer] ✅ Answer received. Connection should establish soon.');
  }
  
  /**
   * Wait for ICE gathering to complete (with timeout to prevent freeze)
   */
  private waitForICEGathering(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      // If already complete, resolve immediately
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      
      // Set timeout to prevent infinite wait (5 seconds max)
      const timeout = setTimeout(() => {
        pc.removeEventListener('icegatheringstatechange', checkState);
        console.warn('[Multiplayer] ICE gathering timeout - proceeding anyway');
        resolve(); // Resolve anyway to prevent freeze
      }, 5000);
      
      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      
      pc.addEventListener('icegatheringstatechange', checkState);
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
   * CRITICAL FIX: Handle disconnection and cleanup properly
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
      
      // CRITICAL: Stop ping loop to prevent memory leak
      this.stopPingLoop();
      
      this.onConnectionChangeCallback?.(false);
    });
    
    dc.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    
    dc.addEventListener('error', (error) => {
      console.error('[Multiplayer] Data channel error:', error);
      logError(error, 'Multiplayer data channel');
      
      // CRITICAL: On error, cleanup and disconnect
      this.disconnect();
    });
  }
  
  /**
   * Handle incoming message
   * CRITICAL: Validate all incoming data to prevent crashes from malformed messages
   */
  private handleMessage(data: string): void {
    try {
      // CRITICAL: Validate JSON format
      if (!data || typeof data !== 'string') {
        console.warn('[Multiplayer] ⚠️ Invalid message data type');
        return;
      }
      
      const message: MessageType = JSON.parse(data);
      
      // CRITICAL: Validate message structure
      if (!message || typeof message !== 'object' || !message.type) {
        console.warn('[Multiplayer] ⚠️ Invalid message structure:', message);
        return;
      }
      
      switch (message.type) {
        case 'hands':
          // CRITICAL: Validate hand data before passing to callback
          if (message.data && typeof message.data === 'object') {
            this.onRemoteHandsCallback?.(message.data);
          }
          break;
        case 'gesture':
          // CRITICAL: Validate gesture data
          if (message.data && message.data.type && message.data.timestamp) {
            this.onRemoteGestureCallback?.(message.data);
          }
          break;
        case 'transform':
          // CRITICAL: Validate transform data
          if (message.data && message.data.type && message.data.modelId) {
            this.onRemoteTransformCallback?.(message.data);
          }
          break;
        case 'ping':
          // Respond with pong
          if (typeof message.timestamp === 'number') {
            this.sendMessage({ type: 'ping', timestamp: message.timestamp });
          }
          break;
        default:
          console.warn('[Multiplayer] ⚠️ Unknown message type:', (message as any).type);
      }
    } catch (error) {
      logError(error, 'Multiplayer message handling');
      // CRITICAL: Don't disconnect on single message error - might be transient
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
   * CRITICAL FIX: Store interval ID so we can clear it on disconnect
   */
  private startPingLoop(): void {
    // Clear any existing ping loop first
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
    }
    
    this.pingIntervalId = window.setInterval(() => {
      if (this.connected && this.dataChannel?.readyState === 'open') {
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
   * Stop ping loop
   * CRITICAL: Must be called on disconnect to prevent memory leak
   */
  private stopPingLoop(): void {
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
      console.log('[Multiplayer] 🛑 Ping loop stopped');
    }
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
   * CRITICAL FIX: Properly cleanup all resources to prevent memory leaks
   */
  disconnect(): void {
    console.log('[Multiplayer] 🛑 Disconnecting and cleaning up...');
    
    // Stop ping loop to prevent memory leak
    this.stopPingLoop();
    
    // Close data channel
    if (this.dataChannel) {
      // Remove event listeners before closing
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onmessage = null;
      this.dataChannel.onerror = null;
      
      if (this.dataChannel.readyState === 'open') {
        this.dataChannel.close();
      }
      this.dataChannel = null;
    }
    
    // Close peer connection
    if (this.peerConnection) {
      // Remove event listeners before closing
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ondatachannel = null;
      this.peerConnection.onicegatheringstatechange = null;
      
      if (this.peerConnection.connectionState !== 'closed') {
        this.peerConnection.close();
      }
      this.peerConnection = null;
    }
    
    // Reset state
    this.connected = false;
    this.isHost = false;
    this.latency = 0;
    this.lastPingTime = 0;
    this.lastHandUpdateTime = 0;
    
    // Notify disconnection
    this.onConnectionChangeCallback?.(false);
    
    console.log('[Multiplayer] ✅ Cleanup complete');
  }
}

