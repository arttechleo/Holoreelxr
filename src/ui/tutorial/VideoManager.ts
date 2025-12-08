// src/ui/tutorial/VideoManager.ts
import * as THREE from 'three';

/**
 * Video source descriptor - supports WebM with MP4 fallback.
 * Can be a simple string URL (backward compatible) or an object with webm/mp4.
 */
export type VideoSource = string | { webm: string; mp4?: string };

/**
 * Check if the browser supports WebM video playback.
 * Cached result for performance.
 */
let webmSupportCache: boolean | null = null;
function supportsWebM(): boolean {
  if (webmSupportCache !== null) {
    return webmSupportCache;
  }
  
  try {
    const video = document.createElement('video');
    const canPlay = video.canPlayType('video/webm; codecs="vp9"');
    webmSupportCache = canPlay === 'probably' || canPlay === 'maybe';
    console.log(`[VideoManager] WebM support detected: ${webmSupportCache} (canPlayType: ${canPlay})`);
    return webmSupportCache;
  } catch (e) {
    console.warn('[VideoManager] Error checking WebM support:', e);
    webmSupportCache = false;
    return false;
  }
}

/**
 * Resolve a VideoSource to a single URL string.
 * Prefers WebM if supported, falls back to MP4, then to webm as last resort.
 */
export function resolveVideoUrl(source: VideoSource): string {
  if (typeof source === 'string') {
    return source; // Backward compatible: simple string URL
  }
  
  // Object format: { webm: string; mp4?: string }
  if (supportsWebM() && source.webm) {
    console.log(`[VideoManager] Resolved to WebM: ${source.webm}`);
    return source.webm;
  }
  
  if (source.mp4) {
    console.log(`[VideoManager] Resolved to MP4 (fallback): ${source.mp4}`);
    return source.mp4;
  }
  
  // Last resort: use webm even if not supported (browser will handle error)
  if (source.webm) {
    console.warn(`[VideoManager] Using WebM as last resort (may not be supported): ${source.webm}`);
    return source.webm;
  }
  
  console.error('[VideoManager] Invalid VideoSource: no webm or mp4 URL provided');
  return '';
}

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
   * Preload all videos from the given sources (VideoSource[]).
   * Returns a promise that resolves when all videos are ready to play.
   * Failed videos are logged but don't prevent resolution (so tutorial can still show).
   */
  async preloadAll(sources: VideoSource[]): Promise<void> {
    // Resolve all VideoSource to actual URLs
    const urls = sources.map(source => resolveVideoUrl(source)).filter(url => url);
    const uniqueUrls = Array.from(new Set(urls)); // Remove duplicates
    
    if (uniqueUrls.length === 0) {
      return;
    }
    
    const t0 = performance.now();
    console.log(`[VideoManager] Preloading ${uniqueUrls.length} videos... (t=${t0.toFixed(2)}ms)`);
    
    // Use Promise.allSettled so one failure doesn't block others
    const loadPromises = uniqueUrls.map(url => {
      const urlT0 = performance.now();
      return this.preloadVideo(url).then(() => {
        const urlT1 = performance.now();
        console.log(`[VideoManager] ✅ Video preloaded: ${url} (${(urlT1 - urlT0).toFixed(2)}ms)`);
      }).catch(err => {
        const urlT1 = performance.now();
        console.error(`[VideoManager] ⚠️ Video preload failed (will continue): ${url} (${(urlT1 - urlT0).toFixed(2)}ms)`, err);
        // Mark as not ready but don't throw
        this.readyStates.set(url, false);
        return Promise.resolve(); // Resolve to continue
      });
    });
    
    await Promise.all(loadPromises);
    
    const t1 = performance.now();
    const readyCount = uniqueUrls.filter(url => this.readyStates.get(url) === true).length;
    console.log(`[VideoManager] ✅ Preload complete: ${readyCount}/${uniqueUrls.length} videos ready (total: ${(t1 - t0).toFixed(2)}ms)`);
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
      const t0 = performance.now();
      const onLoadedData = () => {
        clearTimeout(timeoutId);
        const t1 = performance.now();
        this.readyStates.set(url, true);
        console.log(`[VideoManager] ✅ loadeddata for ${video.src || url} (${(t1 - t0).toFixed(2)}ms)`);
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
          const t1 = performance.now();
          console.warn(
            `[VideoManager] ⏱️ Timeout waiting for loadeddata on ${video.src || url}, ` +
            `readyState=${readyState} (marking as ready for streaming, ${(t1 - t0).toFixed(2)}ms)`
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
   * Get a preloaded video element by source (VideoSource or resolved URL).
   * Returns undefined if the video hasn't been preloaded yet.
   */
  getVideo(source: VideoSource | string): HTMLVideoElement | undefined {
    const url = typeof source === 'string' ? source : resolveVideoUrl(source);
    return this.videos.get(url);
  }

  /**
   * Get or create a THREE.VideoTexture for the given video source (VideoSource or resolved URL).
   * The texture is cached and reused.
   */
  getTexture(source: VideoSource | string): THREE.VideoTexture | undefined {
    const url = typeof source === 'string' ? source : resolveVideoUrl(source);
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
   * Check if a video is ready to play (by VideoSource or resolved URL).
   */
  isReady(source: VideoSource | string): boolean {
    const url = typeof source === 'string' ? source : resolveVideoUrl(source);
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
   * Check if a video failed to load (by VideoSource or resolved URL).
   */
  hasError(source: VideoSource | string): boolean {
    const url = typeof source === 'string' ? source : resolveVideoUrl(source);
    return this.errorStates.get(url) === true;
  }

  /**
   * Play a video by source (VideoSource or resolved URL). Pauses all other videos first.
   * CRITICAL: Only call this when tutorial is visible and step is current.
   */
  playVideo(source: VideoSource | string): void {
    const url = typeof source === 'string' ? source : resolveVideoUrl(source);
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
   * Pause a video by source (VideoSource or resolved URL).
   */
  pauseVideo(source: VideoSource | string): void {
    const url = typeof source === 'string' ? source : resolveVideoUrl(source);
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

