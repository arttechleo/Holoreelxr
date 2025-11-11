// src/ui/ReactionHudManager.ts
import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment } from './ReactionHud';

type Counts = { like: number; heart: number; repost: number };

export class ReactionHudManager {
  private hud: ReactionHud;

  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();
  private currentKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
  }

  // icons
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) {
    this.hud.setIcons(heartUrl, likeUrl, repostUrl);
  }

  // bind/show
  showFor(modelKey: string) {
    this.currentKey = modelKey;

    const c = this.getCounts(modelKey);
    this.hud.setCounts(c.like, c.heart, c.repost);

    if (!this.comments.has(modelKey) || this.comments.get(modelKey)!.length === 0) {
      this.comments.set(modelKey, [
        { id:'s1', author:'Ada', text:'Sed ut perspiciatis unde omnis iste natus error sit voluptatem.' },
        { id:'s2', author:'Lin', text:'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.' },
        { id:'s3', author:'Sam', text:'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit.' },
        { id:'s4', author:'Mira', text:'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.' }
      ]);
    }
    this.hud.setComments(this.comments.get(modelKey)!);
  }
  getCurrentKey(){ return this.currentKey; }

  // counts
  getCounts(modelKey: string): Counts { return this.counts.get(modelKey) ?? { like:0, heart:0, repost:0 }; }
  bump(modelKey: string, kind: ReactionKind) {
    const c = this.getCounts(modelKey);
    if (kind==='like') c.like++; else if (kind==='heart') c.heart++; else c.repost++;
    this.counts.set(modelKey, c);
    if (this.currentKey === modelKey) { this.hud.setCounts(c.like,c.heart,c.repost); this.hud.flash(kind); }
  }

  // comments
  addCommentForCurrent(text: string, author='You') {
    if (!this.currentKey) return;
    const list = this.comments.get(this.currentKey) ?? [];
    const c: Comment = { id:`c-${Date.now()}`, author, text };
    list.push(c); this.comments.set(this.currentKey, list);
    this.hud.appendComment(c);
  }
  scrollComments(steps:number){ this.hud.scrollComments(steps); }

  // ray / world hit helpers (used by controls)
  hitTestWorld(worldPoint: THREE.Vector3){ return this.hud.projectHitFromPoint(worldPoint, { maxPlaneDistance: 0.30, marginPx: 14 }); }
  raycastHit(ray: THREE.Ray){ return this.hud.raycastHit(ray, 14); }

  // tick
  tick(dt:number){ this.hud.tick(dt); }
}

export default ReactionHudManager;
