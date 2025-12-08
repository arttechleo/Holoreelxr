// src/ui/tutorial/VideoManager.ts
import * as THREE from 'three';

/**
 * Central video manager for preloading and caching tutorial gesture videos.
 * Ensures videos are ready before they're shown and provides smooth playback.
 */
export class VideoManager {
  private videos = new Map<string, HTMLVideoElement>();
  private textures = new Map<string, THREE.VideoTexture>();
  private readyStates = new Map<string, boolean>();
  private loadingPromises = new Map<string, Promise<void>>();

  /**
   * Preload all videos from the given URLs.
   * Returns a promise that resolves when all videos are ready to play.
   */
  async preloadAll(urls: string[]): Promise<void> {
    const uniqueUrls = Array.from(new Set(urls.filter(url => url))); // Remove duplicates and empty strings
    
    console.log(`[VideoManager] Preloading ${uniqueUrls.length} videos...`);
    
    const loadPromises = uniqueUrls.map(url => this.preloadVideo(url));
    
    await Promise.all(loadPromises);
    
    console.log(`[VideoManager] ✅ All ${uniqueUrls.length} videos preloaded and ready`);
  }

  /**
   * Preload a single video and return a promise that resolves when it's ready.
   */
  private preloadVideo(url: string): Promise<void> {
    // Return existing promise if already loading
    if (this.loadingPromises.has(url)) {
      return this.loadingPromises.get(url)!;
    }

    // Return immediately if already ready
    if (this.readyStates.get(url)) {
      return Promise.resolve();
    }

    const promise = new Promise<void>((resolve, reject) => {
      // Create video element
      const video = document.createElement('video');
      video.src = url;
      video.preload = 'auto';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.controls = false;
      video.crossOrigin = 'anonymous';

      // Mark as ready when can play through
      video.addEventListener('canplaythrough', () => {
        this.readyStates.set(url, true);
        console.log(`[VideoManager] ✅ Video ready: ${url}`);
        resolve();
      }, { once: true });

      // Handle errors
      video.addEventListener('error', (e) => {
        console.error(`[VideoManager] ❌ Failed to load video: ${url}`, e);
        this.readyStates.set(url, false);
        reject(new Error(`Failed to load video: ${url}`));
      }, { once: true });

      // Start loading
      video.load();
      
      // Store video element
      this.videos.set(url, video);
    });

    this.loadingPromises.set(url, promise);
    return promise;
  }

  /**
   * Get a preloaded video element by URL.
   * Returns undefined if the video hasn't been preloaded yet.
   */
  getVideo(url: string): HTMLVideoElement | undefined {
    return this.videos.get(url);
  }

  /**
   * Get or create a THREE.VideoTexture for the given video URL.
   * The texture is cached and reused.
   */
  getTexture(url: string): THREE.VideoTexture | undefined {
    if (!this.textures.has(url)) {
      const video = this.getVideo(url);
      if (!video) {
        return undefined;
      }

      const texture = new THREE.VideoTexture(video);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      
      this.textures.set(url, texture);
      console.log(`[VideoManager] Created VideoTexture for: ${url}`);
    }

    return this.textures.get(url);
  }

  /**
   * Check if a video is ready to play.
   */
  isReady(url: string): boolean {
    return this.readyStates.get(url) === true;
  }

  /**
   * Play a video by URL. Pauses all other videos first.
   */
  playVideo(url: string): void {
    // Pause all other videos
    this.videos.forEach((video, videoUrl) => {
      if (videoUrl !== url) {
        video.pause();
        video.currentTime = 0; // Reset to start
      }
    });

    // Play the requested video
    const video = this.getVideo(url);
    if (video && this.isReady(url)) {
      video.currentTime = 0; // Reset to start
      video.play().catch(err => {
        console.warn(`[VideoManager] Failed to play video ${url}:`, err);
      });
    }
  }

  /**
   * Pause a video by URL.
   */
  pauseVideo(url: string): void {
    const video = this.getVideo(url);
    if (video) {
      video.pause();
    }
  }

  /**
   * Dispose of all videos and textures.
   */
  dispose(): void {
    // Pause all videos
    this.videos.forEach(video => {
      video.pause();
      video.src = '';
      video.load();
    });

    // Dispose textures
    this.textures.forEach(texture => {
      texture.dispose();
    });

    // Clear maps
    this.videos.clear();
    this.textures.clear();
    this.readyStates.clear();
    this.loadingPromises.clear();
  }
}

// Singleton instance
let videoManagerInstance: VideoManager | null = null;

/**
 * Get the global VideoManager instance.
 */
export function getVideoManager(): VideoManager {
  if (!videoManagerInstance) {
    videoManagerInstance = new VideoManager();
  }
  return videoManagerInstance;
}

