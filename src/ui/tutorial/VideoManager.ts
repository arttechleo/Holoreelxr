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
  private errorStates = new Map<string, boolean>(); // Track which videos failed to load
  private loadingPromises = new Map<string, Promise<void>>();

  /**
   * Preload all videos from the given URLs.
   * Returns a promise that resolves when all videos are ready to play.
   * Failed videos are logged but don't prevent resolution (so tutorial can still show).
   */
  async preloadAll(urls: string[]): Promise<void> {
    const uniqueUrls = Array.from(new Set(urls.filter(url => url))); // Remove duplicates and empty strings
    
    console.log(`[VideoManager] Preloading ${uniqueUrls.length} videos...`);
    
    // Use Promise.allSettled so one failure doesn't block others
    const loadPromises = uniqueUrls.map(url => 
      this.preloadVideo(url).catch(err => {
        console.error(`[VideoManager] ⚠️ Video preload failed (will continue): ${url}`, err);
        // Mark as not ready but don't throw
        this.readyStates.set(url, false);
        return Promise.resolve(); // Resolve to continue
      })
    );
    
    await Promise.all(loadPromises);
    
    const readyCount = uniqueUrls.filter(url => this.readyStates.get(url) === true).length;
    console.log(`[VideoManager] ✅ Preload complete: ${readyCount}/${uniqueUrls.length} videos ready`);
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
      video.preload = 'metadata'; // just enough for first frame + metadata
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.controls = false;
      video.crossOrigin = 'anonymous';

      // We want fast "ready enough" behavior:
      // - loadeddata fires when the first frame is available
      // - plus a timeout fallback so we never hang forever
      const onLoadedData = () => {
        clearTimeout(timeoutId);
        this.readyStates.set(url, true);
        console.log(`[VideoManager] ✅ loadeddata for ${video.src || url}`);
        resolve();
      };

      const onError = (e: Event) => {
        clearTimeout(timeoutId);
        const error = video.error;
        const errorMsg = error ? `code ${error.code}: ${error.message}` : 'unknown error';
        console.error(`[VideoManager] ❌ ERROR loading video ${video.src || url}:`, errorMsg, e);
        this.readyStates.set(url, false);
        this.errorStates.set(url, true); // Mark as failed
        reject(new Error(`Failed to load video: ${url} - ${errorMsg}`));
      };

      const timeoutId = window.setTimeout(() => {
        // Fallback: if we never got loadeddata, but the browser has some data,
        // consider it "ready enough" for streaming playback.
        if (!this.readyStates.get(url)) {
          const readyState = video.readyState;
          console.warn(
            `[VideoManager] ⏱️ Timeout waiting for loadeddata on ${video.src || url}, ` +
            `readyState=${readyState} (marking as ready for streaming)`
          );
          this.readyStates.set(url, true);
        }
        resolve();
      }, 2000); // 2s fallback

      video.addEventListener('loadeddata', onLoadedData, { once: true });
      video.addEventListener('error', onError, { once: true });

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
    if (this.readyStates.get(url) === true) {
      return true;
    }
    const video = this.videos.get(url);
    if (!video) return false;

    // If the browser already has enough data to play the current position,
    // treat it as ready even if our explicit flag hasn't flipped yet.
    return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }

  /**
   * Check if a video failed to load.
   */
  hasError(url: string): boolean {
    return this.errorStates.get(url) === true;
  }

  /**
   * Play a video by URL. Pauses all other videos first.
   * CRITICAL: Only call this when tutorial is visible and step is current.
   */
  playVideo(url: string): void {
    console.log(`[VideoManager] playVideo called for: ${url}`);
    
    // Pause all other videos
    this.videos.forEach((video, videoUrl) => {
      if (videoUrl !== url) {
        video.pause();
        video.currentTime = 0; // Reset to start
      }
    });

    // Play the requested video
    const video = this.getVideo(url);
    if (video) {
      // If we think it's ready, great; otherwise still try to play and let the
      // browser stream/buffer on the fly.
      const ready = this.isReady(url);
      console.log(`[VideoManager] playVideo for ${url} (ready=${ready}, readyState=${video.readyState})`);

      try {
        video.currentTime = 0; // Reset to start
        const playPromise = video.play();
        if (playPromise && typeof playPromise.then === 'function') {
          playPromise.catch(err => {
            console.warn(`[VideoManager] Failed to play video ${url}:`, err);
          });
        }
        console.log(`[VideoManager] ✅ Video playing (or attempting to): ${url}`);
      } catch (err) {
        console.warn(`[VideoManager] Failed to play video ${url}:`, err);
      }
    } else {
      console.warn(
        `[VideoManager] ⚠️ Cannot play video ${url} - no video element in cache (did preloadAll run?)`
      );
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
    this.errorStates.clear();
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

