export class Hud {
  private el: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private playerEl: HTMLDivElement;

  constructor(){
    this.el = document.createElement('div');
    this.el.style.position = 'fixed';
    this.el.style.top = '12px';
    this.el.style.left = '12px';
    this.el.style.zIndex = '10';
    this.el.style.display = 'flex';
    this.el.style.flexDirection = 'column';
    this.el.style.gap = '8px';

    this.toastEl = document.createElement('div');
    this.toastEl.style.background = 'rgba(0,0,0,.45)';
    this.toastEl.style.color = '#fff';
    this.toastEl.style.padding = '6px 10px';
    this.toastEl.style.borderRadius = '8px';
    this.toastEl.textContent = 'Ready';

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

    this.el.appendChild(this.toastEl);
    this.el.appendChild(this.playerEl);
    document.body.appendChild(this.el);
  }

  toast(msg:string){
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    setTimeout(()=> this.toastEl.style.opacity = '0.8', 800);
  }

  mountPlayer(onPlay: ()=>void, onPause: ()=>void){
    (document.getElementById('mvp-play') as HTMLButtonElement).onclick = onPlay;
    (document.getElementById('mvp-pause') as HTMLButtonElement).onclick = onPause;
  }
}
