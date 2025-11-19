import * as THREE from 'three';
import { ReactionHud, ReactionKind, Comment, HudHit } from './ReactionHud';

type Counts = { like: number; heart: number; repost: number };

/**
 * Per-model state for counts + comments, single HUD instance following the active model.
 */
export class ReactionHudManager {
  private hud: ReactionHud;
  private scene: THREE.Scene;
  private cam: THREE.Camera;
  private getObjPosition: () => THREE.Vector3 | null;
  private iconsOffset = new THREE.Vector3(-0.25, -0.05, 0.0);
  private commentOffset = new THREE.Vector3(0.25, 0, 0.0);
  
  // Get group references for dynamic positioning
  private reactIcons: THREE.Group;
  private commentHud: THREE.Group;

  private counts = new Map<string, Counts>();
  private comments = new Map<string, Comment[]>();
  private currentKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    getObjectWorldPos: () => THREE.Vector3 | null
  ) {
    this.scene = scene;
    this.cam = camera;
    this.getObjPosition = getObjectWorldPos;
    this.hud = new ReactionHud(scene, camera, getObjectWorldPos);
    
    // Get HUD group references (using any to access private members)
    this.reactIcons = (this.hud as any).reactIcons;
    this.commentHud = (this.hud as any).commentHud;

  }

  // data
  getCounts(modelKey: string): Counts {
    return this.counts.get(modelKey) ?? { like: 0, heart: 0, repost: 0 };
  }
  getComments(modelKey: string): Comment[] {
    return this.comments.get(modelKey) ?? [];
  }

  // icons
  setIcons(heartUrl?: string, likeUrl?: string, repostUrl?: string) {
    this.hud.setIcons(heartUrl, likeUrl, repostUrl);
  }

  /** Position offsets for icons (left) and comments panel (right) */
  setOffsets(iconsOffset: THREE.Vector3, panelOffset: THREE.Vector3) {
    this.iconsOffset.copy(iconsOffset);
    this.commentOffset.copy(panelOffset);
    (this.hud as any).setOffsets?.(iconsOffset, panelOffset);
  }

  // comments
  setComments(modelKey: string, list: Comment[]) {
    this.comments.set(modelKey, list.slice());
    if (this.currentKey === modelKey) this.hud.setComments(list);
  }
  scrollComments(steps: number) {
    this.hud.scrollComments(steps);
  }

  isComposing() {
    return false;
  }

  // show/bind
  showFor(modelKey: string) {
    this.currentKey = modelKey;

    const c = this.getCounts(modelKey);
    this.hud.setCounts(c.like, c.heart, c.repost);

    if (!this.comments.has(modelKey) || this.comments.get(modelKey)!.length === 0) {
      const seed: Comment[] = [
        { id: 's1', author: 'Ada', text: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem.' },
        { id: 's2', author: 'Lin', text: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.' },
        { id: 's3', author: 'Sam', text: 'Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit.' },
        { id: 's4', author: 'Mira', text: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.' }
      ];
      this.comments.set(modelKey, seed);
    }
    this.hud.setComments(this.comments.get(modelKey)!);
  }

  hide() { /* panel remains visible by design */ }

  // counters
  bump(modelKey: string, kind: ReactionKind) {
    const c = this.getCounts(modelKey);
    if (kind === 'like') c.like += 1;
    else if (kind === 'heart') c.heart += 1;
    else c.repost += 1;
    this.counts.set(modelKey, c);

    if (this.currentKey === modelKey) {
      this.hud.setCounts(c.like, c.heart, c.repost);
      this.hud.flash(kind);
    }
  }

  // interaction helpers
  raycastHit(ray: THREE.Ray): HudHit { return this.hud.raycastHit(ray, 14); }
  projectHitFromPoint(p: THREE.Vector3): HudHit { return this.hud.projectHitFromPoint(p); }
  postQuickComment() { this.hud.postQuickComment(); }

  getPanelCenterWorld(): THREE.Vector3 { return this.hud.getPanelCenterWorld(); }

  tick(dt: number) { 
    // Dynamically update HUD positioning
    this.updateDynamicPositioning();
    this.hud.tick(dt); 
  }
  
  private updateDynamicPositioning() {
    // Dynamic HUD positioning based on gaze and object orientation
    const objPos = this.getObjPosition();
    if (!objPos) return;
    
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.cam.getWorldPosition(camPos);
    this.cam.getWorldDirection(camDir);

    // Calculate optimal HUD position based on object rotation and gaze
    const toObj = objPos.clone().sub(camPos).normalize();
    const viewAlignment = camDir.dot(toObj); // How aligned is camera with object?

    // Dynamic offset based on view alignment - HUDs move further when looking away
    const dynamicScale = 1.0 + (0.3 * (1.0 - viewAlignment));
    const scaledIconsOffset = this.iconsOffset.clone().multiplyScalar(dynamicScale);
    const scaledCommentOffset = this.commentOffset.clone().multiplyScalar(dynamicScale);

    // Update positions with smoother following
    if (this.reactIcons) {
      const targetPos = objPos.clone().add(scaledIconsOffset);
      this.reactIcons.position.lerp(targetPos, 0.15); // Responsive but smooth
      this.reactIcons.lookAt(camPos);
    }

    if (this.commentHud) {
      const targetPos = objPos.clone().add(scaledCommentOffset);
      this.commentHud.position.lerp(targetPos, 0.15);
      this.commentHud.lookAt(camPos);
    }
  }
}

export default ReactionHudManager;
