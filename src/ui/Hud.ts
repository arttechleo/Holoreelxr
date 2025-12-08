export class Hud {
  private el: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private playerEl: HTMLDivElement;
  private reactionEl: HTMLDivElement;
  private likeCountEl: HTMLSpanElement;
  private heartCountEl: HTMLSpanElement;
  private commentsEl: HTMLDivElement;
  private fadeTimer: number | null = null;

  private likeCount = 0;
  private heartCount = 0;

  constructor() {
    // ===== Root =====
    this.el = document.createElement('div');
    this.el.classList.add('hud-root');
    document.body.appendChild(this.el);

    // ===== Toast =====
    this.toastEl = document.createElement('div');
    this.toastEl.classList.add('hud-toast');
    this.toastEl.textContent = 'Ready';
    this.el.appendChild(this.toastEl);

    // ===== Player =====
    // Hide player panel in main feed (music UI is disabled in main feed)
    this.playerEl = document.createElement('div');
    this.playerEl.classList.add('hud-player-panel', 'is-hidden-in-main-feed');
    this.playerEl.innerHTML = `
      <button id="mvp-play">▶︎</button>
      <button id="mvp-pause">⏸</button>
      <span>Global soundtrack</span>
    `;
    this.el.appendChild(this.playerEl);

    // ===== Reaction HUD =====
    this.reactionEl = document.createElement('div');
    this.reactionEl.classList.add('hud-reaction', 'is-hidden');
    // Dynamic opacity is handled via classes (is-visible/is-hidden)

    // Reaction content
    const title = document.createElement('div');
    title.classList.add('hud-reaction-title');
    title.textContent = 'Reactions';
    this.reactionEl.appendChild(title);

    const row = document.createElement('div');
    row.classList.add('hud-reaction-row');
    this.reactionEl.appendChild(row);

    const like = document.createElement('div');
    like.innerHTML = `👍 <span id="hud-like">0</span>`;
    const heart = document.createElement('div');
    heart.innerHTML = `❤️ <span id="hud-heart">0</span>`;
    row.appendChild(like);
    row.appendChild(heart);
    this.likeCountEl = like.querySelector('span')!;
    this.heartCountEl = heart.querySelector('span')!;

    // Comments
    this.commentsEl = document.createElement('div');
    this.commentsEl.classList.add('hud-reaction-comments');
    this.commentsEl.innerHTML = `
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <p>Integer faucibus magna non tincidunt mattis, nec viverra nibh enim eget velit.</p>
    `;
    this.reactionEl.appendChild(this.commentsEl);

    document.body.appendChild(this.reactionEl);
  }

  // === Toast logic ===
  toast(msg: string) {
    this.toastEl.textContent = msg;
    // Use classes for opacity transitions (CSS handles the transition)
    this.toastEl.classList.remove('is-fading');
    this.toastEl.classList.add('is-visible');
    setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this.toastEl.classList.add('is-fading');
    }, 800);
  }

  mountPlayer(onPlay: () => void, onPause: () => void) {
    (document.getElementById('mvp-play') as HTMLButtonElement).onclick = onPlay;
    (document.getElementById('mvp-pause') as HTMLButtonElement).onclick = onPause;
  }

  // === Reaction HUD ===
  showReaction(kind: 'like' | 'heart') {
    if (kind === 'like') {
      this.likeCount++;
      this.likeCountEl.textContent = String(this.likeCount);
    } else {
      this.heartCount++;
      this.heartCountEl.textContent = String(this.heartCount);
    }

    // Use classes for visibility (CSS handles the transition)
    this.reactionEl.classList.remove('is-hidden');
    this.reactionEl.classList.add('is-visible');

    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.reactionEl.classList.remove('is-visible');
      this.reactionEl.classList.add('is-hidden');
    }, 1500);
  }
}
