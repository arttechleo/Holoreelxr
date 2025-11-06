export class GlobalPlayer {
  private audio = new Audio('/assets/track.mp3'); // fallback file (put in public/assets)

  play(){ this.audio.play().catch(()=>{/* user gesture may be required until XR starts */}); }
  pause(){ this.audio.pause(); }
}
