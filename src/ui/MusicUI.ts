// src/ui/MusicUI.ts
import { MusicManager, Track } from '../music/MusicManager';

export class MusicUI {
  private manager: MusicManager;
  private container: HTMLElement;

  constructor(manager: MusicManager, containerId = 'music-ui') {
    this.manager = manager;
    const el = document.getElementById(containerId);
    if (!el) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      document.body.appendChild(this.container);
    } else {
      this.container = el;
    }
    this.render();
    this.manager.onPlaybackChange((track, playing) => {
      this.updateUI();
    });
  }

  private render() {
    this.container.innerHTML = `
      <div style="position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.9); color: white; padding: 20px; border-radius: 8px; z-index: 10000; font-family: sans-serif; min-width: 300px;">
        <h3 style="margin: 0 0 15px 0;">Music Player</h3>
        <div style="margin-bottom: 15px;">
          <button id="sign-in-spotify" 
                  style="width: 100%; padding: 10px; background: #1DB954; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 8px;">
            Sign in with Spotify
          </button>
          <button id="sign-in-soundcloud" 
                  style="width: 100%; padding: 10px; background: #FF5500; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Sign in with SoundCloud
          </button>
        </div>
        <div id="music-player-content"></div>
      </div>
    `;
    
    (this.container.querySelector('#sign-in-spotify') as HTMLButtonElement)?.addEventListener('click', () => {
      this.manager.signInSpotify();
    });
    (this.container.querySelector('#sign-in-soundcloud') as HTMLButtonElement)?.addEventListener('click', () => {
      this.manager.signInSoundCloud();
    });
    
    this.updateUI();
  }

  private updateUI() {
    const content = this.container.querySelector('#music-player-content');
    if (!content) return;

    const track = this.manager.getCurrentTrack();
    const playing = this.manager.isCurrentlyPlaying();

    if (track) {
      content.innerHTML = `
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; margin-bottom: 5px;">${track.title}</div>
          <div style="font-size: 12px; color: #aaa;">${track.artist}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="play-pause-btn" 
                  style="flex: 1; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
            ${playing ? 'Pause' : 'Play'}
          </button>
          <button id="stop-btn" 
                  style="flex: 1; padding: 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Stop
          </button>
        </div>
      `;
      (content.querySelector('#play-pause-btn') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.togglePlayback();
      });
      (content.querySelector('#stop-btn') as HTMLButtonElement)?.addEventListener('click', () => {
        this.manager.stop();
      });
    } else {
      content.innerHTML = '<p style="color: #888; font-size: 12px;">No track playing</p>';
    }
  }

  show() {
    this.container.style.display = 'block';
  }

  hide() {
    this.container.style.display = 'none';
  }
}

