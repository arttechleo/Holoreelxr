import { ThreeXRApp } from './app/ThreeXRApp';
import { HandEngine } from './gestures/HandEngine';
import { FeedControls } from './controls/FeedControls';
import { FeedStore } from './feed/FeedStore';
import { Hud } from './ui/Hud';
import { GlobalPlayer } from './integrations/player';
import { checkWebXRSupport, logError } from './utils/errors';
import { detectXRMode, getXRBackground } from './config/xr';
import { AssetLinkManager } from './feed/AssetLinkManager';
import { AuthManager } from './auth/AuthManager';
import { MusicManager } from './music/MusicManager';
import { AssetLinkUI } from './ui/AssetLinkUI';
import { AuthUI } from './ui/AuthUI';
import { MusicUI } from './ui/MusicUI';
import { XRAuthPanel } from './ui/XRAuthPanel';
import { XRMusicPanel } from './ui/XRMusicPanel';
import { OnboardingTutorial } from './ui/OnboardingTutorial';
import * as THREE from 'three';

// ========== INITIALIZATION ==========
const app = new ThreeXRApp();
const hands = new HandEngine(app.renderer);
const hud = new Hud();
const store = new FeedStore(app.contentRoot, (t)=>hud.toast(t));
const player = new GlobalPlayer();

// New managers
const assetLinkMgr = new AssetLinkManager(store);
const authMgr = new AuthManager();
const musicMgr = new MusicManager();

// 2D UI (desktop only - hidden in XR)
const assetLinkUI = new AssetLinkUI(assetLinkMgr);
const authUI = new AuthUI(authMgr);
const musicUI = new MusicUI(musicMgr);

// Hide 2D UI initially (will show in XR via 3D panels)
authUI.hide();
musicUI.hide();

// 3D XR UI panels (Mixed Reality)
const xrAuthPanel = new XRAuthPanel(authMgr, app.scene);
const xrMusicPanel = new XRMusicPanel(musicMgr, app.scene);

// Onboarding tutorial (only shows in XR)
const onboarding = new OnboardingTutorial(app.scene, hands, store);
onboarding.setOnComplete(() => {
  onboarding.hide();
  // Start loading feed after tutorial completes
  loadMainFeed();
});

// Sync asset links to feed when added
assetLinkUI.setOnLinkAdded(() => {
  const items = assetLinkMgr.getFeedItems();
  if (items.length > 0) {
    store.setItems([...store.items, ...items]);
  }
});

hud.mountPlayer(()=> player.play(), ()=> player.pause());

// Check WebXR support and show status
(async () => {
  const support = await checkWebXRSupport();
  console.log('WebXR Support:', support);
  
  if (!support.supported) {
    hud.toast('⚠️ WebXR not supported in this browser');
  } else {
    const modes: string[] = [];
    if (support.ar) modes.push('AR');
    if (support.vr) modes.push('VR');
    hud.toast(`✅ WebXR ready: ${modes.join(', ')}`);
  }
})().catch(err => logError(err, 'WebXR check'));

// ========== LOAD FEED ==========
async function loadMainFeed() {
  try {
    hud.toast('Loading feed...');
    await store.loadFeed();
    
    if (store.items.length === 0) {
      hud.toast('⚠️ Feed is empty');
      return;
    }
    
    hud.toast('Loading content...');
    await store.showCurrent();
    hud.toast('✅ Ready! Use gestures or keyboard shortcuts');
  } catch (error) {
    logError(error, 'Main feed loading');
    hud.toast('❌ Failed to load feed');
  }
}

// Load feed immediately for desktop, or wait for onboarding in XR
(async () => {
  try {
    // Load feed for desktop (onboarding only shows in XR)
    await loadMainFeed();

  // Keep joints flowing
  app.onFrame((info) => { 
    hands.update(info);
    // Update 3D panels to face camera
    xrAuthPanel.update(app.camera);
    xrMusicPanel.update(app.camera);
  });

  // When XR session starts, place the current item in front of the user:
  // ~1.0 m forward in view direction, Y = 0.5m above floor (local-floor → ground at y=0)
  (app.renderer.xr as any).addEventListener('sessionstart', (event: any) => {
    const session = event.session as XRSession;
    
    // Detect VR vs MR mode
    const mode = detectXRMode(session);
    console.log(`🥽 XR Mode: ${mode.toUpperCase()}`);
    
    // Adjust background based on mode
    const bgColor = getXRBackground(mode);
    if (bgColor !== null) {
      app.scene.background = new THREE.Color(bgColor);
    } else {
      app.scene.background = null; // Transparent for MR/AR passthrough
    }
    
    const cam = app.camera;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    cam.getWorldPosition(camPos);
    cam.getWorldDirection(camDir);

    const forwardMeters = 1.0;
    const target = camPos.clone().add(camDir.multiplyScalar(forwardMeters));
    target.y = 0.5; // 0.5 m above ground

    store.setPosition(target);
    hud.toast(`${mode.toUpperCase()} ready - Model placed in front of you`);
  });

    const controls = new FeedControls(app, hands, store);
    // Wire up 3D panels to controls
    (controls as any).authPanel = xrAuthPanel;
    (controls as any).musicPanel = xrMusicPanel;
    
    app.start();
  } catch (error) {
    logError(error, 'Main initialization');
    hud.toast('❌ Failed to initialize app');
  }
})();

// ========== KEYBOARD SHORTCUTS (Desktop Testing) ==========
document.addEventListener('keydown', (e) => {
  // Don't interfere with typing in input fields
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }

  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
      store.next(-1);
      hud.toast('⬅️ Previous item');
      break;
    
    case 'ArrowRight':
    case 'd':
      store.next(+1);
      hud.toast('➡️ Next item');
      break;
    
    case 'ArrowUp':
    case 'w':
      store.setTargetTransform(store.scale * 1.2, store.rotationY);
      hud.toast('🔍 Zoom in');
      break;
    
    case 'ArrowDown':
    case 's':
      store.setTargetTransform(store.scale / 1.2, store.rotationY);
      hud.toast('🔍 Zoom out');
      break;
    
    case 'q':
      store.setTargetTransform(store.scale, store.rotationY - Math.PI / 4);
      hud.toast('🔄 Rotate left');
      break;
    
    case 'e':
      store.setTargetTransform(store.scale, store.rotationY + Math.PI / 4);
      hud.toast('🔄 Rotate right');
      break;
    
    case 'l':
      store.likeCurrent();
      hud.toast('👍 Liked!');
      break;
    
    case 'h':
      store.saveCurrent();
      hud.toast('❤️ Saved!');
      break;
    
    case 'r':
      store.repostCurrent();
      hud.toast('🔁 Reposted!');
      break;
    
    case 'p':
      if (player.isAvailable()) {
        player.play();
        hud.toast('▶️ Playing audio');
      }
      break;
    
    case '?':
    case 'h' + 'Shift': // Shift+H for help
      if (e.shiftKey) {
        showKeyboardHelp();
      }
      break;
    
    case 'r' + 'Control': // Ctrl+R already reloads page
      // Reserved
      break;
  }
});

// Display keyboard shortcuts help
function showKeyboardHelp() {
  const help = `
╔════════════════════════════════════╗
║    HOLOREELXR KEYBOARD SHORTCUTS    ║
╠════════════════════════════════════╣
║  Navigation:                        ║
║    ← / A  : Previous item          ║
║    → / D  : Next item              ║
║                                    ║
║  Transform:                        ║
║    ↑ / W  : Zoom in                ║
║    ↓ / S  : Zoom out               ║
║    Q      : Rotate left            ║
║    E      : Rotate right           ║
║                                    ║
║  Reactions:                        ║
║    L      : Like                   ║
║    H      : Heart/Save             ║
║    R      : Repost                 ║
║                                    ║
║  Media:                            ║
║    P      : Play audio             ║
║                                    ║
║  XR Mode:                          ║
║    Use Enter AR/VR buttons →      ║
╚════════════════════════════════════╝
  `;
  console.log(help);
  hud.toast('📖 Keyboard shortcuts logged to console');
}

// Show welcome message with keyboard hint
setTimeout(() => {
  console.log('%c🎮 Holoreelxr Alpha v1.0.0', 'font-size: 16px; font-weight: bold; color: #667eea;');
  console.log('%cPress Shift+H for keyboard shortcuts', 'color: #999;');
}, 1000);
