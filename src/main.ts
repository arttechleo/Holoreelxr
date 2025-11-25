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
import { MultiplayerManager, HandState, GestureEvent, TransformEvent } from './multiplayer/MultiplayerManager';
import { RemoteHands } from './multiplayer/RemoteHands';
import { MultiplayerUI } from './multiplayer/MultiplayerUI';
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

// EXPERIMENTAL: Multiplayer system (real-time hand tracking & gesture sync)
const multiplayer = new MultiplayerManager();
const remoteHands = new RemoteHands(app.scene);
const multiplayerUI = new MultiplayerUI();

// Setup multiplayer callbacks
multiplayer.onRemoteHands((hands: HandState) => {
  remoteHands.update(hands);
});

multiplayer.onRemoteGesture((gesture: GestureEvent) => {
  console.log('[Multiplayer] 🎉 Partner performed gesture:', gesture.type);
  hud.toast(`👥 Partner: ${gesture.type} emoji!`);
  // Visual feedback - show emoji at partner's position
});

multiplayer.onRemoteTransform((transform: TransformEvent) => {
  console.log('[Multiplayer] 🔄 Partner transformed model:', transform.type);
  // Apply transform to local model (synchronized experience)
  if (transform.type === 'scale' && transform.scale) {
    store.setTargetTransform(transform.scale, store.rotationY);
  } else if (transform.type === 'rotate' && transform.rotation) {
    store.setTargetTransform(store.scale, transform.rotation);
  } else if (transform.type === 'place' && transform.position) {
    store.setPosition(new THREE.Vector3(
      transform.position.x,
      transform.position.y,
      transform.position.z
    ));
  }
});

multiplayer.onConnectionChange((connected: boolean) => {
  if (connected) {
    hud.toast('🎉 Multiplayer connected!');
    remoteHands.setVisible(true);
  } else {
    hud.toast('❌ Multiplayer disconnected');
    remoteHands.setVisible(false);
  }
  multiplayerUI.setConnectionStatus(connected);
});

// Setup multiplayer UI callbacks
multiplayerUI.onHost(async () => {
  return await multiplayer.createSession();
});

multiplayerUI.onJoin(async (offer: string) => {
  return await multiplayer.joinSession(offer);
});

multiplayerUI.onAnswer(async (answer: string) => {
  await multiplayer.receiveAnswer(answer);
});
onboarding.setOnComplete(() => {
  // Tutorial will handle hiding itself and navigating to first non-tutorial item
  console.log('[Main] Tutorial completed callback called');
  console.log(`[Main] Current feed index: ${store.index}, items.length: ${store.items.length}`);
  
  // Ensure feed is properly loaded and index is valid
  if (store.items.length === 0) {
    console.error('[Main] Feed is empty after tutorial!');
    return;
  }
  
  // Validate index is within bounds
  if (store.index < 0 || store.index >= store.items.length) {
    console.warn(`[Main] Invalid feed index ${store.index}, resetting to 0`);
    store.index = 0;
  }
  
  // Feed index has already been set by tutorial, ensure content is shown
  const item = store.items[store.index];
  console.log(`[Main] Showing feed item at index ${store.index}: ${item?.title || item?.id || 'unknown'}`);
  store.showCurrent().catch(err => {
    console.error('[Main] Error showing current feed after tutorial:', err);
    logError(err, 'Show current after tutorial');
  });
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
    // Load feed first (needed for onboarding tutorial items)
    await loadMainFeed();
    
    // Show onboarding in XR, or show first item on desktop
    if (app.renderer.xr.isPresenting) {
      onboarding.show(app.camera);
    } else {
      // Desktop: show first item immediately
      await store.showCurrent();
    }

    // Keep joints flowing
  app.onFrame((info) => { 
    hands.update(info);
    
    // EXPERIMENTAL: Broadcast hand positions to multiplayer partner (throttled)
    if (multiplayer.isConnected()) {
      const leftPinchMid = hands.pinchMid('left');
      const rightPinchMid = hands.pinchMid('right');
      
      const handState: HandState = {
        left: {
          position: leftPinchMid ? { x: leftPinchMid.x, y: leftPinchMid.y, z: leftPinchMid.z } : null,
          rotation: null,
          pinching: hands.state.left.pinch
        },
        right: {
          position: rightPinchMid ? { x: rightPinchMid.x, y: rightPinchMid.y, z: rightPinchMid.z } : null,
          rotation: null,
          pinching: hands.state.right.pinch
        }
      };
      
      multiplayer.broadcastHands(handState);
    }
    
    // Update 3D panels to face camera
    xrAuthPanel.update(app.camera);
    xrMusicPanel.update(app.camera);
    
    // Update tutorial panel position to the right of the 3D model
    // CRITICAL: Only update if tutorial is actually active
    if (onboarding.isVisible() && (onboarding as any).isTutorialActive?.()) {
      const objPos = store.getObjectWorldPos();
      const camPos = new THREE.Vector3();
      app.camera.getWorldPosition(camPos);
      if (objPos) {
        (onboarding as any).updatePosition?.(objPos, camPos);
      }
      
      // Update tutorial grab system (frame-based, reliable)
      // Only call if tutorial is actually active
      (onboarding as any).updateGrab?.(info);
    }
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
    
    // Show onboarding tutorial in XR
    onboarding.show(cam);
  });

    const controls = new FeedControls(app, hands, store);
    // Wire up 3D panels to controls
    (controls as any).authPanel = xrAuthPanel;
    (controls as any).musicPanel = xrMusicPanel;
    // Disable FeedControls during onboarding tutorial
    controls.setOnboardingTutorial(onboarding);
    // Pass FeedControls reference to tutorial for state checking
    (onboarding as any).setFeedControls(controls);
    
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
    
    case 'm':
    case 'M':
      // Toggle multiplayer UI (press M)
      multiplayerUI.show();
      hud.toast('🎮 Press M to open multiplayer');
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
