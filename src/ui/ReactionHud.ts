// src/ui/ReactionHud.ts
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

type Kind = 'like' | 'heart';

export class ReactionHud {
  private renderer: CSS2DRenderer;
  private anchor = new THREE.Object3D();
  private panelObj: CSS2DObject;

  private container: HTMLDivElement;
  private likeCountEl: HTMLSpanElement;
  private heartCountEl: HTMLSpanElement;
  private chipEl: HTMLDivElement;
  private fadeTimer: number | null = null;
  private visible = false;

  private likeCount = 0;
  private heartCount = 0;

  private readonly OFFSET = new THREE.Vector3(0, 0.15, 0); // a bit above the model
  private readonly AUTO_HIDE_MS = 1500;

  /**
   * @param scene three.js scene
   * @param camera scene camera
   * @param getObjectWorldPos returns current world position of the model (center)
   * @param mount optional element for CSS2D canvas; defaults to document.body
   */
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private getObjectWorldPos: () => THREE.Vector3 | null,
    mount?: HTMLElement | null
  ) {
    // CSS2D overlay canvas
    this.renderer = new CSS2DRenderer();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.pointerEvents = 'none';
    (mount ?? document.body).appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Panel DOM
    this.container = document.createElement('div');
    this.container.style.pointerEvents = 'auto';
    this.container.style.opacity = '0';
    this.container.style.transition = 'opacity 150ms ease';
    this.container.style.userSelect = 'none';

    const panel = document.createElement('div');
    panel.style.minWidth = '220px';
    panel.style.maxWidth = '280px';
    panel.style.padding = '12px';
    panel.style.borderRadius = '14px';
    panel.style.background = 'rgba(18,18,28,0.82)';
    panel.style.backdropFilter = 'blur(6px)';
    panel.style.color = '#fff';
    panel.style.boxShadow = '0 6px 20px rgba(0,0,0,0.35)';
    panel.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    panel.style.fontSize = '14px';
    panel.style.position = 'relative';
    this.container.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = 'Reactions';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';
    title.style.opacity = '0.95';
    panel.appendChild(title);

    // counts
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '14px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '8px';
    panel.appendChild(row);

    const makeCount = (emoji: string) => {
      const w = document.createElement('div');
      w.style.display = 'inline-flex';
      w.style.gap = '8px';
      w.style.alignItems = 'center';
      const em = document.createElement('span'); em.textContent = emoji;
      const val = document.createElement('span');
      val.textContent = '0';
      val.style.fontVariantNumeric = 'tabular-nums';
      val.style.opacity = '0.9';
      w.appendChild(em); w.appendChild(val);
      return { w, val };
    };

    const like = makeCount('👍');
    const heart = makeCount('❤️');
    row.appendChild(like.w);
    row.appendChild(heart.w);
    this.likeCountEl = like.val;
    this.heartCountEl = heart.val;

    // comments
    const commentsHeader = document.createElement('div');
    commentsHeader.textContent = 'Comments';
    commentsHeader.style.fontWeight = '700';
    commentsHeader.style.margin = '6px 0 6px';
    commentsHeader.style.opacity = '0.9';
    panel.appendChild(commentsHeader);

    const comments = document.createElement('div');
    comments.style.lineHeight = '1.35';
    comments.style.opacity = '0.95';
    comments.innerHTML = `
      <p style="margin:4px 0;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam eget hendrerit metus.</p>
      <p style="margin:4px 0;">Integer faucibus magna non tincidunt mattis, purus lorem gravida augue, nec viverra nibh enim eget velit.</p>
    `;
    panel.appendChild(comments);

    // +1 chip
    this.chipEl = document.createElement('div');
    this.chipEl.style.position = 'absolute';
    this.chipEl.style.left = '50%';
    this.chipEl.style.top = '-8px';
    this.chipEl.style.transform = 'translate(-50%, -10px)';
    this.chipEl.style.padding = '4px 8px';
    this.chipEl.style.borderRadius = '999px';
    this.chipEl.style.background = 'rgba(255,255,255,0.25)';
    this.chipEl.style.color = '#fff';
    this.chipEl.style.fontWeight = '700';
    this.chipEl.style.opacity = '0';
    this.chipEl.style.transition = 'opacity 120ms ease, transform 420ms cubic-bezier(.2,.7,.2,1)';
    this.chipEl.textContent = '+1';
    panel.appendChild(this.chipEl);

    // attach
    this.panelObj = new CSS2DObject(this.container);
    this.anchor.add(this.panelObj);
    this.scene.add(this.anchor);
  }

  /** call each frame */
  tick() {
    const pos = this.getObjectWorldPos?.();
    if (pos) this.anchor.position.copy(pos).add(this.OFFSET);
    this.renderer.render(this.scene, this.camera);
  }

  /** show + increment */
  bump(kind: Kind) {
    if (kind === 'like') {
      this.likeCount++;
      this.likeCountEl.textContent = String(this.likeCount);
      this.chipEl.textContent = '+1 👍';
    } else {
      this.heartCount++;
      this.heartCountEl.textContent = String(this.heartCount);
      this.chipEl.textContent = '+1 ❤️';
    }

    if (!this.visible) {
      this.visible = true;
      this.container.style.opacity = '1';
    }

    // chip pop
    this.chipEl.style.opacity = '1';
    this.chipEl.style.transform = 'translate(-50%, -22px)';
    setTimeout(() => {
      this.chipEl.style.opacity = '0';
      this.chipEl.style.transform = 'translate(-50%, -10px)';
    }, 320);

    // auto hide
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.container.style.opacity = '0';
      this.visible = false;
    }, this.AUTO_HIDE_MS);
  }
}
