/**
 * MultiplayerManager - Real-time multiplayer for HoloreelXR
 * Enables two users to share hand gestures, emoji reactions, and 3D model transforms
 * 
 * Uses PeerJS for automatic WebRTC signaling (simplifies connection setup)
 */

import { logError } from '../utils/errors';
import Peer, { DataConnection } from 'peerjs';

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
  private peer: Peer | null = null;
  private dataConnection: DataConnection | null = null;
  private isHost = false;
  private connected = false;
  private myPeerId: string | null = null;
  
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
  private pingIntervalId: number | null = null;
  
  constructor() {
    console.log('[Multiplayer] 🎮 Initializing MultiplayerManager with PeerJS');
  }
  
  /**
   * Get my Peer ID (for sharing with others to connect)
   */
  getMyPeerId(): string | null {
    return this.myPeerId;
  }
  
  /**
   * Create a new multiplayer session as HOST
   * Returns a Peer ID that guest can use to connect
   */
  async createSession(): Promise<string> {
    console.log('[Multiplayer] Creating session as HOST');
    
    try {
      // Cleanup old connection if exists
      if (this.peer || this.dataConnection) {
        console.warn('[Multiplayer] Existing connection found, cleaning up...');
        this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      this.isHost = true;
      
      // Create Peer instance (PeerJS handles all signaling automatically)
      return new Promise((resolve, reject) => {
        // Generate random peer ID for host
        const peerId = 'host-' + Math.random().toString(36).substring(2, 9);
        
        this.peer = new Peer(peerId, {
          host: '0.peerjs.com',
          port: 443,
          path: '/',
          secure: true,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });
        
        this.peer.on('open', (id) => {
          console.log('[Multiplayer] ✅ Host Peer ID:', id);
          this.myPeerId = id;
          resolve(id);
        });
        
        this.peer.on('error', (error) => {
          console.error('[Multiplayer] Peer error:', error);
          reject(error);
        });
        
        // Host waits for incoming connection from guest
        this.peer.on('connection', (conn) => {
          console.log('[Multiplayer] 📡 Incoming connection from guest');
          this.setupDataConnection(conn);
        });
      });
    } catch (error) {
      console.error('[Multiplayer] Create session error:', error);
      this.disconnect();
      throw error;
    }
  }
  
  /**
   * Join an existing session as GUEST
   * Takes the host's Peer ID and connects
   */
  async joinSession(hostPeerId: string): Promise<void> {
    console.log('[Multiplayer] 🎮 Joining session as GUEST, host ID:', hostPeerId);
    
    try {
      // Cleanup old connection if exists
      if (this.peer || this.dataConnection) {
        console.warn('[Multiplayer] ⚠️ Existing connection found, cleaning up...');
        this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      this.isHost = false;
      
      // Create Peer instance for guest
      return new Promise((resolve, reject) => {
        // Guest gets random ID
        const guestId = 'guest-' + Math.random().toString(36).substring(2, 9);
        
        this.peer = new Peer(guestId, {
          host: '0.peerjs.com',
          port: 443,
          path: '/',
          secure: true,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          }
        });
        
        this.peer.on('open', (id) => {
          console.log('[Multiplayer] ✅ Guest Peer ID:', id);
          this.myPeerId = id;
          
          // Connect to host
          const conn = this.peer!.connect(hostPeerId, {
            reliable: false,
            serialization: 'json'
          });
          
          this.setupDataConnection(conn);
          
          // Resolve when connection opens
          conn.on('open', () => {
            console.log('[Multiplayer] ✅ Connected to host!');
            resolve();
          });
        });
        
        this.peer.on('error', (error) => {
          console.error('[Multiplayer] Peer error:', error);
          reject(error);
        });
      });
    } catch (error) {
      console.error('[Multiplayer] Join session error:', error);
      this.disconnect();
      throw error;
    }
  }
  
  /**
   * Setup data connection for game data
   */
  private setupDataConnection(conn: DataConnection): void {
    // Close old connection if exists
    if (this.dataConnection) {
      this.dataConnection.close();
    }
    
    this.dataConnection = conn;
    
    conn.on('open', () => {
      console.log('[Multiplayer] 📡 Data channel OPEN - ready to sync!');
      this.connected = true;
      this.onConnectionChangeCallback?.(true);
      
      // Start ping loop
      this.startPingLoop();
    });
    
    conn.on('close', () => {
      console.log('[Multiplayer] 📡 Data channel closed');
      this.connected = false;
      this.stopPingLoop();
      this.onConnectionChangeCallback?.(false);
    });
    
    conn.on('data', (data: any) => {
      this.handleMessage(data);
    });
    
    conn.on('error', (error) => {
      console.error('[Multiplayer] Data connection error:', error);
      logError(error, 'Multiplayer data connection');
      this.disconnect();
    });
  }
  
  /**
   * Handle incoming message
   */
  private handleMessage(data: any): void {
    try {
      // PeerJS sends JSON automatically, but validate
      if (!data || typeof data !== 'object' || !data.type) {
        console.warn('[Multiplayer] ⚠️ Invalid message structure:', data);
        return;
      }
      
      const message: MessageType = data;
      
      switch (message.type) {
        case 'hands':
          if (message.data && typeof message.data === 'object') {
            this.onRemoteHandsCallback?.(message.data);
          }
          break;
        case 'gesture':
          if (message.data && message.data.type && message.data.timestamp) {
            this.onRemoteGestureCallback?.(message.data);
          }
          break;
        case 'transform':
          if (message.data && message.data.type && message.data.modelId) {
            this.onRemoteTransformCallback?.(message.data);
          }
          break;
        case 'ping':
          if (typeof message.timestamp === 'number') {
            this.sendMessage({ type: 'ping', timestamp: message.timestamp });
          }
          break;
        default:
          console.warn('[Multiplayer] ⚠️ Unknown message type:', (message as any).type);
      }
    } catch (error) {
      logError(error, 'Multiplayer message handling');
    }
  }
  
  /**
   * Send message to peer
   */
  private sendMessage(message: MessageType): void {
    if (!this.dataConnection || !this.dataConnection.open) {
      return;
    }
    
    try {
      this.dataConnection.send(message);
    } catch (error) {
      // Silently fail if connection is closed
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
    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
    }
    
    this.pingIntervalId = window.setInterval(() => {
      if (this.connected && this.dataConnection?.open) {
        const now = performance.now();
        this.sendMessage({ type: 'ping', timestamp: now });
        
        if (this.lastPingTime > 0) {
          this.latency = now - this.lastPingTime;
        }
        this.lastPingTime = now;
      }
    }, 1000);
  }
  
  /**
   * Stop ping loop
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
   */
  disconnect(): void {
    console.log('[Multiplayer] 🛑 Disconnecting and cleaning up...');
    
    this.stopPingLoop();
    
    if (this.dataConnection) {
      if (this.dataConnection.open) {
        this.dataConnection.close();
      }
      this.dataConnection = null;
    }
    
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    
    this.connected = false;
    this.isHost = false;
    this.myPeerId = null;
    this.latency = 0;
    this.lastPingTime = 0;
    this.lastHandUpdateTime = 0;
    
    this.onConnectionChangeCallback?.(false);
    
    console.log('[Multiplayer] ✅ Cleanup complete');
  }
}
