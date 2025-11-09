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
    this.el.style.position = 'fixed';
    this.el.style.top = '12px';
    this.el.style.left = '12px';
    this.el.style.zIndex = '10';
    this.el.style.display = 'flex';
    this.el.style.flexDirection = 'column';
    this.el.style.gap = '8px';
    document.body.appendChild(this.el);

    // ===== Toast =====
    this.toastEl = document.createElement('div');
    this.toastEl.style.background = 'rgba(0,0,0,.45)';
    this.toastEl.style.color = '#fff';
    this.toastEl.style.padding = '6px 10px';
    this.toastEl.style.borderRadius = '8px';
    this.toastEl.style.transition = 'opacity 0.3s ease';
    this.toastEl.textContent = 'Ready';
    this.el.appendChild(this.toastEl);

    // ===== Player =====
    this.playerEl = document.createElement('div');
    this.playerEl.style.background = 'rgba(0,0,0,.45)';
    this.playerEl.style.color = '#fff';
    this.playerEl.style.padding = '6px 10px';
    this.playerEl.style.borderRadius = '8px';
    this.playerEl.innerHTML = `
      <button id="mvp-play">▶︎</button>
      <button id="mvp-pause">⏸</button>
      <span>Global soundtrack</span>
    `;
    this.el.appendChild(this.playerEl);

    // ===== Reaction HUD =====
    this.reactionEl = document.createElement('div');
    this.reactionEl.style.position = 'absolute';
    this.reactionEl.style.top = '80px';
    this.reactionEl.style.left = '50%';
    this.reactionEl.style.transform = 'translateX(-50%)';
    this.reactionEl.style.background = 'rgba(20,20,30,0.8)';
    this.reactionEl.style.backdropFilter = 'blur(8px)';
    this.reactionEl.style.color = '#fff';
    this.reactionEl.style.padding = '12px 18px';
    this.reactionEl.style.borderRadius = '12px';
    this.reactionEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
    this.reactionEl.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    this.reactionEl.style.textAlign = 'center';
    this.reactionEl.style.opacity = '0';
    this.reactionEl.style.transition = 'opacity 0.25s ease';
    this.reactionEl.style.pointerEvents = 'none';

    // Reaction content
    const title = document.createElement('div');
    title.textContent = 'Reactions';
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    this.reactionEl.appendChild(title);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.justifyContent = 'center';
    row.style.marginBottom = '8px';
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
    this.commentsEl.style.maxWidth = '280px';
    this.commentsEl.style.fontSize = '13px';
    this.commentsEl.style.lineHeight = '1.35';
    this.commentsEl.style.opacity = '0.95';
    this.commentsEl.innerHTML = `
      <p style="margin:4px 0;">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      <p style="margin:4px 0;">Integer faucibus magna non tincidunt mattis, nec viverra nibh enim eget velit.</p>
    `;
    this.reactionEl.appendChild(this.commentsEl);

    document.body.appendChild(this.reactionEl);
  }

  // === Toast logic ===
  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    setTimeout(() => (this.toastEl.style.opacity = '0.8'), 800);
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

    this.reactionEl.style.opacity = '1';

    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.reactionEl.style.opacity = '0';
    }, 1500);
  }
}
