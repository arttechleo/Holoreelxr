// src/music/MusicManager.ts
export type MusicProvider = 'spotify' | 'soundcloud';

export interface Track {
  id: string;
  title: string;
  artist: string;
  url: string;
  provider: MusicProvider;
  duration?: number;
  cover?: string;
}

export class MusicManager {
  private currentProvider: MusicProvider | null = null;
  private currentTrack: Track | null = null;
  private isPlaying = false;
  private audio: HTMLAudioElement | null = null;
  private listeners: ((track: Track | null, playing: boolean) => void)[] = [];

  // Sign in to Spotify
  async signInSpotify(): Promise<boolean> {
    // TODO: Implement Spotify OAuth
    // For now, mock implementation
    this.currentProvider = 'spotify';
    return true;
  }

  // Sign in to SoundCloud
  async signInSoundCloud(): Promise<boolean> {
    // TODO: Implement SoundCloud OAuth
    // For now, mock implementation
    this.currentProvider = 'soundcloud';
    return true;
  }

  // Play track
  async playTrack(track: Track): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }

    this.currentTrack = track;
    
    // For SoundCloud, use embed API
    if (track.provider === 'soundcloud') {
      // SoundCloud requires iframe embed or API
      // For now, try direct URL
      this.audio = new Audio(track.url);
    } else if (track.provider === 'spotify') {
      // Spotify requires Web Playback SDK
      // For now, placeholder
      console.warn('Spotify playback requires Web Playback SDK');
    }

    if (this.audio) {
      this.audio.play().then(() => {
        this.isPlaying = true;
        this.notifyListeners();
      }).catch(e => {
        console.error('Failed to play track', e);
      });
    }
  }

  // Pause/Resume
  togglePlayback(): void {
    if (!this.audio) return;
    
    if (this.isPlaying) {
      this.audio.pause();
      this.isPlaying = false;
    } else {
      this.audio.play();
      this.isPlaying = true;
    }
    this.notifyListeners();
  }

  // Stop
  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.isPlaying = false;
    this.notifyListeners();
  }

  // Get current track
  getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  // Check if playing
  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  // Subscribe to playback changes
  onPlaybackChange(callback: (track: Track | null, playing: boolean) => void) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb(this.currentTrack, this.isPlaying));
  }
}

