import { ThreeXRApp } from './app/ThreeXRApp';
import { HandEngine } from './gestures/HandEngine';
import { FeedControls } from './controls/FeedControls';
import { FeedStore } from './feed/FeedStore';
import { Hud } from './ui/Hud';
import { GlobalPlayer } from './integrations/player';

const app = new ThreeXRApp();
const hands = new HandEngine(app.renderer);
const hud = new Hud();
const store = new FeedStore(app.contentRoot, (t)=>hud.toast(t));
const player = new GlobalPlayer();

hud.mountPlayer(()=> player.play(), ()=> player.pause());

(async () => {
  await store.loadFeed();
  await store.showCurrent();

  app.onFrame((info) => {
    hands.update(info); // <-- native WebXR joints
  });

  new FeedControls(app, hands, store);
  app.start();
})();
