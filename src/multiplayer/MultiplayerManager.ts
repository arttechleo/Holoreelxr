/**
 * MultiplayerManager - Real-time multiplayer for HoloreelXR
 * Enables two users to share hand gestures, emoji reactions, and 3D model transforms
 * 
 * Uses PeerJS for automatic WebRTC signaling (simplifies connection setup)
 */

import { logError } from '../utils/errors';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import type { HandJointPayload } from '../gestures/HandEngine';

type Vec3 = { x: number; y: number; z: number };
type QuaternionLike = { x: number; y: number; z: number; w: number };

export interface HandPoseState {
  position: Vec3 | null;
  rotation: QuaternionLike | null;
  pinching: boolean;
  open: boolean;
  joints?: HandJointPayload;
}

export interface HandState {
  left: HandPoseState;
  right: HandPoseState;
  gestures: {
    heart: boolean;
    stopPalm: boolean;
  };
  timestamp: number;
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

export interface FeedSyncState {
  index: number;
  itemId: string | null;
  // CRITICAL FIX: Position, scale, rotationY are now optional (not synced)
  // Each user controls their own model transforms locally
  position?: Vec3 | null; // Optional - not synced
  scale?: number; // Optional - not synced
  rotationY?: number; // Optional - not synced
  timestamp: number;
}

export interface VoiceState {
  enabled: boolean;
  muted: boolean;
  remoteReady: boolean;
  remoteActive: boolean;
  remoteMuted: boolean;
  error?: string;
}

type MessageType = 
  | { type: 'hands'; data: HandState }
  | { type: 'gesture'; data: GestureEvent }
  | { type: 'transform'; data: TransformEvent }
  | { type: 'feed'; data: FeedSyncState }
  | { type: 'voice-ready'; ready: boolean }
  | { type: 'voice-state'; data: { muted: boolean } }
  | { type: 'ping'; timestamp: number };

export class MultiplayerManager {
  private peer: Peer | null = null;
  private dataConnection: DataConnection | null = null;
  private isHost = false;
  private connected = false;
  private myPeerId: string | null = null;
  private role: 'host' | 'guest' | null = null;
  private remotePeerId: string | null = null;
  
  // Callbacks
  private onRemoteHandsCallback?: (hands: HandState) => void;
  private onRemoteGestureCallback?: (gesture: GestureEvent) => void;
  private onRemoteTransformCallback?: (transform: TransformEvent) => void;
  private onConnectionChangeCallback?: (connected: boolean) => void;
  private onRemoteFeedCallback?: (state: FeedSyncState) => void;
  private onVoiceStateChangeCallback?: (state: VoiceState) => void;
  
  // Throttling for hand updates (send max 20 times per second)
  private lastHandUpdateTime = 0;
  private readonly HAND_UPDATE_INTERVAL = 50; // 50ms = 20 FPS - matches MULTIPLAYER.HAND_UPDATE_INTERVAL_MS
  
  // Connection stats
  private latency = 0;
  private lastPingTime = 0;
  private pingIntervalId: number | null = null;
  private pendingPings = new Map<number, number>(); // Track ping timestamps for RTT calculation
  
  // Voice chat
  private mediaConnection: MediaConnection | null = null;
  private localAudioStream: MediaStream | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private localVoiceReady = false;
  private remoteVoiceReady = false;
  private voiceState: VoiceState = {
    enabled: false,
    muted: false,
    remoteReady: false,
    remoteActive: false,
    remoteMuted: false,
  };
  
  constructor() {
    // Logging controlled by PRODUCTION_CONFIG
    if (typeof window !== 'undefined' && (window as any).__DEBUG_MULTIPLAYER) {
      console.log('[Multiplayer] 🎮 Initializing MultiplayerManager with PeerJS');
    }
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
    // Debug logging only in development
    if (typeof window !== 'undefined' && (window as any).__DEBUG_MULTIPLAYER) {
      console.log('[Multiplayer] Creating session as HOST');
    }
    
    try {
      // Cleanup old connection if exists
      if (this.peer || this.dataConnection) {
        console.warn('[Multiplayer] Existing connection found, cleaning up...');
        this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      this.isHost = true;
      this.role = 'host';
      
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
          console.error('[Multiplayer] Peer error (host):', error);
          logError(error, 'Multiplayer createSession');
          // CRITICAL FIX: Cleanup on error
          this.disconnect();
          reject(error);
        });
        
        this.peer.on('call', (call) => {
          this.handleIncomingCall(call);
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
      this.role = 'guest';
      
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
          
          // CRITICAL FIX: Add timeout for connection opening
          const CONNECTION_TIMEOUT_MS = 10000; // 10 seconds - matches MULTIPLAYER.CONNECTION_TIMEOUT_MS
          const connectionTimeout = setTimeout(() => {
            if (!this.connected) {
              console.error(`[Multiplayer] ⚠️ Connection timeout after ${CONNECTION_TIMEOUT_MS / 1000} seconds`);
              this.disconnect();
              reject(new Error('Connection timeout'));
            }
          }, CONNECTION_TIMEOUT_MS);
          
          // Resolve when connection opens
          conn.on('open', () => {
            clearTimeout(connectionTimeout);
            console.log('[Multiplayer] ✅ Connected to host!');
            resolve();
          });
          
          // CRITICAL FIX: Handle connection errors
          conn.on('error', (error) => {
            clearTimeout(connectionTimeout);
            console.error('[Multiplayer] Connection error:', error);
            logError(error, 'Multiplayer connection');
            this.disconnect();
            reject(error);
          });
        });
        
        this.peer.on('error', (error) => {
          console.error('[Multiplayer] Peer error:', error);
          reject(error);
        });
        
        this.peer.on('call', (call) => {
          this.handleIncomingCall(call);
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
    this.remotePeerId = conn.peer;
    
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
      this.cleanupMediaConnection();
      this.remotePeerId = null;
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
        case 'feed':
          if (message.data) {
            this.onRemoteFeedCallback?.(message.data);
          }
          break;
        case 'voice-ready':
          this.remoteVoiceReady = message.ready;
          this.voiceState.remoteReady = message.ready;
          this.notifyVoiceState();
          if (this.isHostRole() && message.ready && this.localVoiceReady) {
            this.startVoiceCall();
          }
          break;
        case 'voice-state':
          if (message.data) {
            this.voiceState.remoteMuted = !!message.data.muted;
            this.notifyVoiceState();
          }
          break;
        case 'ping':
          if (typeof message.timestamp === 'number') {
            // CRITICAL FIX: Calculate round-trip latency correctly
            const now = performance.now();
            const rtt = now - message.timestamp;
            if (rtt > 0 && rtt < 10000) { // Sanity check: RTT should be reasonable (< 10s)
              this.latency = rtt;
            }
            // Echo ping back
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
   * CRITICAL FIX: Enhanced error handling and connection state validation
   */
  private sendMessage(message: MessageType): void {
    if (!this.dataConnection) {
      console.warn('[Multiplayer] ⚠️ Cannot send message: no data connection');
      return;
    }
    
    if (!this.dataConnection.open) {
      console.warn('[Multiplayer] ⚠️ Cannot send message: connection not open');
      return;
    }
    
    try {
      this.dataConnection.send(message);
    } catch (error) {
      // CRITICAL FIX: Log error for debugging, but don't crash
      logError(error, 'Multiplayer sendMessage');
      // If send fails, connection might be broken - disconnect gracefully
      if (error instanceof Error && error.message.includes('closed')) {
        console.warn('[Multiplayer] ⚠️ Connection closed, disconnecting...');
        this.disconnect();
      }
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

  broadcastFeedState(state: FeedSyncState): void {
    this.sendMessage({ type: 'feed', data: state });
  }

  async enableVoice(): Promise<void> {
    if (this.localVoiceReady && this.localAudioStream) {
      this.voiceState.enabled = true;
      this.notifyVoiceState();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      this.localAudioStream = stream;
      this.localVoiceReady = true;
      this.voiceState.enabled = true;
      this.applyMuteState();
      this.voiceState.error = undefined;
      this.notifyVoiceState();
      this.sendMessage({ type: 'voice-ready', ready: true });
      if (this.isHostRole() && this.remoteVoiceReady) {
        this.startVoiceCall();
      }
    } catch (error) {
      logError(error, 'Multiplayer enableVoice');
      this.voiceState.error = (error as Error)?.message || 'Microphone access denied';
      this.voiceState.enabled = false;
      this.notifyVoiceState();
      throw error;
    }
  }

  setVoiceMuted(muted: boolean): void {
    if (this.voiceState.muted === muted) return;
    this.voiceState.muted = muted;
    this.applyMuteState();
    this.notifyVoiceState();
    this.sendMessage({ type: 'voice-state', data: { muted } });
  }

  getVoiceState(): VoiceState {
    return { ...this.voiceState };
  }

  isHostRole(): boolean {
    return this.role === 'host';
  }

  isGuestRole(): boolean {
    return this.role === 'guest';
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
        // CRITICAL FIX: Store ping timestamp for RTT calculation when response arrives
        this.pendingPings.set(now, now);
        this.sendMessage({ type: 'ping', timestamp: now });
        this.lastPingTime = now;
        
        // Cleanup old pending pings (older than 5 seconds)
        for (const [timestamp] of this.pendingPings) {
          if (now - timestamp > 5000) {
            this.pendingPings.delete(timestamp);
          }
        }
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

  onRemoteFeed(callback: (state: FeedSyncState) => void): void {
    this.onRemoteFeedCallback = callback;
  }

  onVoiceStateChange(callback: (state: VoiceState) => void): void {
    this.onVoiceStateChangeCallback = callback;
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
    this.cleanupMediaConnection(true);
    
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
    this.role = null;
    this.remotePeerId = null;
    this.latency = 0;
    this.lastPingTime = 0;
    this.lastHandUpdateTime = 0;
    this.pendingPings.clear(); // CRITICAL FIX: Clear pending pings on disconnect
    
    this.onConnectionChangeCallback?.(false);
    
    console.log('[Multiplayer] ✅ Cleanup complete');
  }

  private notifyVoiceState(): void {
    this.onVoiceStateChangeCallback?.({ ...this.voiceState });
  }

  private applyMuteState(): void {
    if (!this.localAudioStream) return;
    this.localAudioStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.voiceState.muted;
    });
  }

  private startVoiceCall(): void {
    if (!this.peer || !this.localAudioStream || !this.remotePeerId) return;
    if (!this.isHostRole()) return;
    if (this.mediaConnection && this.mediaConnection.open) return;
    const call = this.peer.call(this.remotePeerId, this.localAudioStream);
    if (!call) return;
    this.mediaConnection = call;
    this.setupMediaConnection(call);
  }

  private handleIncomingCall(call: MediaConnection): void {
    if (this.mediaConnection) {
      this.mediaConnection.close();
    }
    this.mediaConnection = call;
    const stream = this.localVoiceReady && this.localAudioStream ? this.localAudioStream : undefined;
    try {
      call.answer(stream);
    } catch (error) {
      logError(error, 'Multiplayer answer voice call');
    }
    this.setupMediaConnection(call);
  }

  private setupMediaConnection(call: MediaConnection): void {
    call.on('stream', (remoteStream) => {
      this.attachRemoteAudio(remoteStream);
      this.voiceState.remoteActive = true;
      this.notifyVoiceState();
    });
    call.on('close', () => {
      this.voiceState.remoteActive = false;
      this.mediaConnection = null;
      this.cleanupRemoteAudio();
      this.notifyVoiceState();
    });
    call.on('error', (error) => {
      logError(error, 'Multiplayer voice call');
      this.voiceState.remoteActive = false;
      this.mediaConnection = null;
      this.cleanupRemoteAudio();
      this.notifyVoiceState();
    });
  }

  private attachRemoteAudio(stream: MediaStream): void {
    if (!this.remoteAudioEl) {
      this.remoteAudioEl = document.createElement('audio');
      this.remoteAudioEl.autoplay = true;
      this.remoteAudioEl.playsInline = true;
      this.remoteAudioEl.style.display = 'none';
      document.body.appendChild(this.remoteAudioEl);
    }
    this.remoteAudioEl.srcObject = stream;
  }

  private cleanupRemoteAudio(): void {
    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
    }
  }

  private cleanupMediaConnection(stopLocalStream = false): void {
    if (this.mediaConnection) {
      try {
        this.mediaConnection.close();
      } catch (error) {
        logError(error, 'Multiplayer cleanup voice call');
      }
      this.mediaConnection = null;
    }
    if (stopLocalStream && this.localAudioStream) {
      this.localAudioStream.getTracks().forEach((track) => track.stop());
      this.localAudioStream = null;
      this.localVoiceReady = false;
      this.voiceState.enabled = false;
    }
    if (stopLocalStream && this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      this.remoteAudioEl.remove();
      this.remoteAudioEl = null;
    } else {
      this.cleanupRemoteAudio();
    }
    if (stopLocalStream) {
      this.voiceState.muted = false;
    }
    this.remoteVoiceReady = false;
    this.voiceState.remoteReady = false;
    this.voiceState.remoteActive = false;
    this.voiceState.remoteMuted = false;
    this.notifyVoiceState();
  }
}
