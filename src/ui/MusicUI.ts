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
    // Hide music UI in main feed (disabled in main.ts)
    this.container.classList.add('music-ui-container', 'is-hidden-in-main-feed');
    this.container.innerHTML = `
      <h3 class="music-ui-title">Music Player</h3>
      <div class="music-ui-auth-buttons">
        <button id="sign-in-spotify" class="music-ui-button music-ui-button--spotify">
          Sign in with Spotify
        </button>
        <button id="sign-in-soundcloud" class="music-ui-button music-ui-button--soundcloud">
          Sign in with SoundCloud
        </button>
      </div>
      <div id="music-player-content"></div>
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
        <div class="music-ui-track-info">
          <div class="music-ui-track-title">${track.title}</div>
          <div class="music-ui-track-artist">${track.artist}</div>
        </div>
        <div class="music-ui-controls">
          <button id="play-pause-btn" class="music-ui-control-button music-ui-control-button--play">
            ${playing ? 'Pause' : 'Play'}
          </button>
          <button id="stop-btn" class="music-ui-control-button music-ui-control-button--stop">
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
      content.innerHTML = '<p class="music-ui-empty-state">No track playing</p>';
    }
  }

  show() {
    this.container.classList.remove('is-hidden');
  }

  hide() {
    this.container.classList.add('is-hidden');
  }
}

