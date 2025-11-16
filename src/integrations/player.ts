export class GlobalPlayer {
  private audio?: HTMLAudioElement;

  constructor() {
    // Optional audio - gracefully handle missing file
    try {
      this.audio = new Audio('/assets/track.mp3');
      this.audio.addEventListener('error', () => {
        console.warn('Audio file not found - player disabled');
        this.audio = undefined;
      });
    } catch (error) {
      console.warn('Audio not supported or failed to load:', error);
      this.audio = undefined;
    }
  }

  play() {
    if (!this.audio) return;
    this.audio.play().catch(() => {
      /* user gesture may be required until XR starts */
    });
  }

  pause() {
    if (!this.audio) return;
    this.audio.pause();
  }

  isAvailable(): boolean {
    return !!this.audio;
  }
}
