import { ThreeXRApp } from './app/ThreeXRApp';
import { HandEngine } from './gestures/HandEngine';
import { FeedControls } from './controls/FeedControls';
import { FeedStore } from './feed/FeedStore';
import { Hud } from './ui/Hud';
import { GlobalPlayer } from './integrations/player';
import * as THREE from 'three';

const app = new ThreeXRApp();
const hands = new HandEngine(app.renderer);
const hud = new Hud();
const store = new FeedStore(app.contentRoot, (t)=>hud.toast(t));
const player = new GlobalPlayer();

hud.mountPlayer(()=> player.play(), ()=> player.pause());

(async () => {
  await store.loadFeed();
  await store.showCurrent();

  // Keep joints flowing
  app.onFrame((info) => { hands.update(info); });

  // When XR session starts, place the current item in front of the user:
  // ~1.0 m forward in view direction, Y = 0.5m above floor (local-floor → ground at y=0)
  (app.renderer.xr as any).addEventListener('sessionstart', () => {
    const cam = app.camera;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    cam.getWorldPosition(camPos);
    cam.getWorldDirection(camDir);

    const forwardMeters = 1.0;
    const target = camPos.clone().add(camDir.multiplyScalar(forwardMeters));
    target.y = 0.5; // 0.5 m above ground

    store.setPosition(target);
    hud.toast('Placed model in front of you');
  });

  new FeedControls(app, hands, store);
  app.start();
})();
