import { ThreeXRApp } from './app/ThreeXRApp';
import { HandEngine } from './gestures/HandEngine';
import { FeedControls } from './controls/FeedControls';
import { FeedStore } from './feed/FeedStore';
import { Hud } from './ui/Hud';
import { GlobalPlayer } from './integrations/player';
import { checkWebXRSupport, logError } from './utils/errors';
import { detectXRMode, getXRBackground } from './config/xr';
import { MULTIPLAYER } from './config/constants';
import { logger } from './config/production';
import { AssetLinkManager } from './feed/AssetLinkManager';
import { AuthManager } from './auth/AuthManager';
import { MusicManager } from './music/MusicManager';
import { AssetLinkUI } from './ui/AssetLinkUI';
import { AuthUI } from './ui/AuthUI';
import { MusicUI } from './ui/MusicUI';
import { XRAuthPanel } from './ui/XRAuthPanel';
import { XRMusicPanel } from './ui/XRMusicPanel';
import { OnboardingTutorial } from './ui/OnboardingTutorial';
import { XRGaussianEngagementPanel } from './ui/XRGaussianEngagementPanel';
import { debugGaussianSplatScene, restoreDebugHighlights } from './debug/SceneDebug';
import { MultiplayerManager, HandState, GestureEvent, TransformEvent } from './multiplayer/MultiplayerManager';
import { RemoteHands } from './multiplayer/RemoteHands';
import { XRMultiplayerPanel } from './ui/XRMultiplayerPanelCanvas';
import * as THREE from 'three';

// Import centralized UI stylesheet
import './ui/style.css';

// ========== INITIALIZATION ==========
const app = new ThreeXRApp();
const hands = new HandEngine(app.renderer);
const hud = new Hud();
const store = new FeedStore(app.contentRoot, (t)=>hud.toast(t));
const player = new GlobalPlayer();

// Expose app globally for debugging (can be removed in production)
(window as any).app = app;
(window as any).hud = hud; // Expose for UI gating

// New managers
const assetLinkMgr = new AssetLinkManager(store);
const authMgr = new AuthManager();
const musicMgr = new MusicManager();

// 2D UI (desktop only - production GS build: only keep essential UI)
const assetLinkUI = new AssetLinkUI(assetLinkMgr);
// Auth and music 2D UI disabled for production GS viewer
// const authUI = new AuthUI(authMgr);
// const musicUI = new MusicUI(musicMgr);

// 3D XR UI panels (Mixed Reality)
// For production GS viewer, disable auth & music panels to avoid overlapping UI.
// Multiplayer panel remains enabled.
const ENABLE_AUTH_PANELS = false; // Set to true to re-enable auth/music panels

const xrAuthPanel = ENABLE_AUTH_PANELS ? new XRAuthPanel(authMgr, app.scene) : null;
const xrMusicPanel = ENABLE_AUTH_PANELS ? new XRMusicPanel(musicMgr, app.scene) : null;

// EXPERIMENTAL: Multiplayer system (real-time hand tracking & gesture sync)
const multiplayer = new MultiplayerManager();
const remoteHands = new RemoteHands(app.scene);
const xrMultiplayerPanel = new XRMultiplayerPanel(
  app.scene, 
  multiplayer,
  () => store.getObjectWorldPos(), // Like ReactionHud - callback to get object position
  () => app.camera // Camera for keypad positioning
);

// Onboarding tutorial (only shows in XR)
const onboarding = new OnboardingTutorial(app.scene, hands, store);

// Lightweight engagement panel for .ply Gaussian splats (not canvas-based to avoid XR artifacts)
const engagementPanel = new XRGaussianEngagementPanel(app.scene, app.camera);
engagementPanel.setCallbacks({
  onHeart: () => {
    store.saveCurrent();
    hud.toast('❤️ Hearted!');
  },
  onLike: () => {
    store.likeCurrent();
    hud.toast('👍 Liked!');
  },
  onRepost: () => {
    store.repostCurrent();
    hud.toast('🔁 Reposted!');
  },
});

const FEED_SYNC_MIN_INTERVAL_MS = MULTIPLAYER.FEED_SYNC_MIN_INTERVAL_MS;
const FEED_SYNC_TRAILING_MS = MULTIPLAYER.FEED_SYNC_TRAILING_MS;
const FEED_SYNC_HEARTBEAT_MS = MULTIPLAYER.FEED_SYNC_HEARTBEAT_MS;

type FeedSyncReason = 'scroll' | 'keyboard' | 'heartbeat' | 'trailing';

let lastFeedSyncAt = 0;
let lastFeedSignature = '';
let feedSyncTrailingHandle: ReturnType<typeof setTimeout> | null = null;
let pendingFeedSync = Promise.resolve();

const broadcastFeedSync = (
  reason: FeedSyncReason,
  options: { force?: boolean; skipTrailing?: boolean } = {}
) => {
  if (!multiplayer.isConnected()) return;
  const snapshot = store.getStateSnapshot();
  const signature = `${snapshot.index}:${snapshot.itemId ?? 'null'}`;
  const now = performance.now();
  const force = options.force ?? false;
  const skipTrailing = options.skipTrailing ?? false;
  
  if (!force && signature === lastFeedSignature && now - lastFeedSyncAt < FEED_SYNC_MIN_INTERVAL_MS) {
    if (!skipTrailing) {
      scheduleTrailingFeedSync();
    }
    return;
  }
  
  sendFeedSnapshot(snapshot, skipTrailing);
};

function sendFeedSnapshot(
  snapshot: ReturnType<typeof store.getStateSnapshot>,
  skipTrailing: boolean
) {
  lastFeedSignature = `${snapshot.index}:${snapshot.itemId ?? 'null'}`;
  lastFeedSyncAt = performance.now();
  multiplayer.broadcastFeedState({
    index: snapshot.index,
    itemId: snapshot.itemId,
    timestamp: lastFeedSyncAt,
  });
  if (!skipTrailing) {
    scheduleTrailingFeedSync();
  }
}

function scheduleTrailingFeedSync() {
  if (feedSyncTrailingHandle) {
    clearTimeout(feedSyncTrailingHandle);
  }
  feedSyncTrailingHandle = window.setTimeout(() => {
    feedSyncTrailingHandle = null;
    if (!multiplayer.isConnected()) return;
    const latest = store.getStateSnapshot();
    const signature = `${latest.index}:${latest.itemId ?? 'null'}`;
    if (signature !== lastFeedSignature) {
      sendFeedSnapshot(latest, false);
    }
  }, FEED_SYNC_TRAILING_MS);
}

// Expose multiplayer panel globally for easy access from connect.html or console
(window as any).multiplayerPanel = xrMultiplayerPanel;
(window as any).multiplayer = multiplayer;
(window as any).setMultiplayerJoinCode = (code: string) => {
  xrMultiplayerPanel.setJoinCode(code);
  console.log('[Main] Join code set via global function:', code);
};

// Setup multiplayer callbacks
multiplayer.onRemoteHands((hands: HandState) => {
  // ENHANCED: Always update remote hands when data is received
  // Pass camera for mirrored player positioning
  remoteHands.update(hands, app.camera);
  // Ensure remote hands are visible when connected
  if (multiplayer.isConnected()) {
    remoteHands.setVisible(true);
  }
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
    if (multiplayer.isHostRole()) {
      broadcastFeedSync('scroll', { force: true });
    }
  } else {
    hud.toast('❌ Multiplayer disconnected');
    remoteHands.setVisible(false);
  }
  xrMultiplayerPanel.onConnectionChange(connected);
});

multiplayer.onRemoteFeed((state) => {
  pendingFeedSync = pendingFeedSync.then(() => store.applyRemoteState(state));
});

xrMultiplayerPanel.setVoiceControls({
  onStart: () => multiplayer.enableVoice(),
  onToggleMute: () => multiplayer.setVoiceMuted(!multiplayer.getVoiceState().muted),
});
multiplayer.onVoiceStateChange((state) => {
  xrMultiplayerPanel.updateVoiceState(state);
});
xrMultiplayerPanel.updateVoiceState(multiplayer.getVoiceState());
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
  
  // Show content and trigger content mode change to set up UI panels
  store.showCurrent().then(() => {
    // CRITICAL: Explicitly trigger content mode change after content loads
    // This ensures multiplayer panel is enabled/shown for primitives and GLB models
    if ((store as any).onContentModeChange) {
      (store as any).onContentModeChange();
      console.log('[Main] ✅ Content mode change triggered after tutorial');
    }
    
    // Ensure multiplayer panel is shown after tutorial (for primitives OR GLB models)
    const contentKind = store.getContentKind();
    if (!multiplayer.isConnected() && (contentKind.isPrimitive || contentKind.isGlbModel)) {
      setTimeout(() => {
        // Panel should already be enabled by onContentModeChange, just ensure it's shown
        if (xrMultiplayerPanel.isEnabled()) {
          xrMultiplayerPanel.show();
          console.log('[Main] ✅ Multiplayer panel shown after tutorial', {
            isPrimitive: contentKind.isPrimitive,
            isGlbModel: contentKind.isGlbModel,
            enabled: xrMultiplayerPanel.isEnabled(),
            visible: xrMultiplayerPanel.isVisible()
          });
        } else {
          console.warn('[Main] ⚠️ Multiplayer panel not enabled after tutorial!', {
            contentKind,
            enabled: xrMultiplayerPanel.isEnabled()
          });
        }
      }, 500); // Reduced delay for faster appearance
    }
  }).catch(err => {
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
  let lastStopPalmToggle = 0;
  let stopPalmWasActive = false; // Track previous state for edge detection
  const STOP_PALM_COOLDOWN = 500; // 500ms cooldown to prevent rapid toggling
  
  // Performance monitoring (lightweight, only when GS active)
  let frameCount = 0;
  
  app.onFrame((info) => {
    const frameStart = performance.now(); 
    hands.update(info);
    
    // ENHANCED: Single-tap host panel toggle (edge detection on stop-palm gesture)
    // CRITICAL FIX: Only allow multiplayer panel AFTER tutorial is complete
    // Use edge detection: trigger on stopPalm becoming true (not while held)
    const now = performance.now();
    const stopPalmActive = hands.state.stopPalm;
    const stopPalmJustActivated = stopPalmActive && !stopPalmWasActive; // Edge detection
    
    if (stopPalmJustActivated && !multiplayer.isConnected() && !onboarding.isTutorialActive() && (now - lastStopPalmToggle) > STOP_PALM_COOLDOWN) {
      lastStopPalmToggle = now;
      // Toggle panel visibility (original behavior - works when panel is enabled)
      // Panel is disabled automatically when GS is active
      if (!xrMultiplayerPanel.isVisible()) {
        xrMultiplayerPanel.show();
        hud.toast('🎮 Multiplayer panel opened!');
      } else {
        xrMultiplayerPanel.hide();
        hud.toast('Multiplayer panel closed');
      }
    }
    
    // Update previous state for edge detection
    stopPalmWasActive = stopPalmActive;
    
    // EXPERIMENTAL: Broadcast hand positions to multiplayer partner (throttled)
    // OPTIMIZATION: Reuse Vector3/Quaternion objects to avoid allocations
    if (multiplayer.isConnected()) {
      const leftPinchMid = hands.pinchMid('left');
      const rightPinchMid = hands.pinchMid('right');
      const jointSnapshot = hands.getJointSnapshot();
      const wristLeft = hands.getJointQuaternion('left', 'wrist');
      const wristRight = hands.getJointQuaternion('right', 'wrist');
      const now = performance.now();
      
      // OPTIMIZATION: Reuse objects instead of creating new ones every frame
      // These are module-level to persist across frames
      if (!(window as any).__multiplayerTempVec) {
        (window as any).__multiplayerTempVec = new THREE.Vector3();
        (window as any).__multiplayerTempQuat = new THREE.Quaternion();
      }
      const headPos = (window as any).__multiplayerTempVec;
      const headQuat = (window as any).__multiplayerTempQuat;
      
      app.camera.getWorldPosition(headPos);
      app.camera.getWorldQuaternion(headQuat);
      
      const handState: HandState = {
        left: {
          position: leftPinchMid
            ? { x: leftPinchMid.x, y: leftPinchMid.y, z: leftPinchMid.z }
            : jointSnapshot.left['wrist'] ?? null,
          rotation: wristLeft
            ? { x: wristLeft.x, y: wristLeft.y, z: wristLeft.z, w: wristLeft.w }
            : null,
          pinching: hands.state.left.pinch,
          open: hands.state.left.open,
          joints: jointSnapshot.left,
        },
        right: {
          position: rightPinchMid
            ? { x: rightPinchMid.x, y: rightPinchMid.y, z: rightPinchMid.z }
            : jointSnapshot.right['wrist'] ?? null,
          rotation: wristRight
            ? { x: wristRight.x, y: wristRight.y, z: wristRight.z, w: wristRight.w }
            : null,
          pinching: hands.state.right.pinch,
          open: hands.state.right.open,
          joints: jointSnapshot.right,
        },
        gestures: {
          heart: hands.state.heart,
          stopPalm: hands.state.stopPalm,
        },
        timestamp: now,
        // Head/body position for player presence
        headPosition: { x: headPos.x, y: headPos.y, z: headPos.z },
        headRotation: { x: headQuat.x, y: headQuat.y, z: headQuat.z, w: headQuat.w },
      };
      
      multiplayer.broadcastHands(handState);
      
    }
    
    // Update 3D panels to face camera
    // Update 3D panels to face camera (if enabled)
    xrAuthPanel?.update(app.camera);
    xrMusicPanel?.update(app.camera);
    
    // ========== PERFORMANCE: GS mode is handled ONCE per item change, not every frame ==========
    // All GS mode logic (canvas disabling, panel attachment) happens in FeedStore.showCurrent()
    // via the onGaussianSplatModeChange callback. This prevents freezes from per-frame checks.
    
    // Update engagement panel billboard effect (for both GLB and PLY files when visible)
    if (engagementPanel.isPanelVisible()) {
      engagementPanel.update(app.camera);
    }
    
    // Update multiplayer panel (like ReactionHud - positions itself relative to object)
    // NOTE: tick() internally checks if panel is enabled, so it's safe to call always
    const dt = 0.016; // ~60fps
    xrMultiplayerPanel.tick(dt);
    
    if (multiplayer.isConnected()) {
      const heartbeatNow = performance.now();
      if (heartbeatNow - lastFeedSyncAt > FEED_SYNC_HEARTBEAT_MS) {
        broadcastFeedSync('heartbeat', { force: true, skipTrailing: true });
      }
    }
    
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
    
    // Performance monitoring: log long frames in GS mode (debug only)
    const frameEnd = performance.now();
    const frameTime = frameEnd - frameStart;
    frameCount++;
    
    if ((app as any)._currentGsState && frameTime > 20) {
      // Log only occasionally to avoid spam (every 60 frames ~ 1 second at 60fps)
      if (frameCount % 60 === 0) {
        console.warn(`[Main] ⚠️ Long frame in GS mode: ${frameTime.toFixed(2)}ms (threshold: 20ms)`);
      }
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
    // CRITICAL FIX: Set multiplayer panel reference for keyboard interaction
    controls.setMultiplayerPanel(xrMultiplayerPanel);
    // Set engagement panel reference for interaction handling
    controls.setEngagementPanel(engagementPanel);
    controls.setFeedSyncCallback(() => broadcastFeedSync('scroll'));
    
    // ========== MULTIPLAYER PANEL: Enable by default, disable only for GS ==========
    // RESTORED: Original approach from commit 5a13113 - panel enabled by default
    // Only disabled when Gaussian splat is active (prevents phantom canvas artifacts)
    // Panel positioning happens automatically via tick() method using getObjectWorldPos()
    
    // Initialize panel as enabled (will be disabled if GS is active)
    xrMultiplayerPanel.setEnabled(true);
    
    // ========== GAUSSIAN SPLAT MODE CHANGE HANDLER ==========
    // Handle GS mode changes (called ONCE when item changes, not every frame)
    (store as any).onGaussianSplatModeChange = (isGsActive: boolean, gsState: ReturnType<typeof store.getGaussianSplatState>) => {
      if (isGsActive) {
        // GAUSSIAN SPLAT ACTIVE: Disable multiplayer panel and other canvas UI
        logger.verbose('[Main] 🔴 Gaussian Splat active - disabling multiplayer panel and canvas UI');
        
        // Disable multiplayer panel (fully stops canvas updates, removes from scene)
        xrMultiplayerPanel.setEnabled(false);
        
        // KEEP ReactionHud ENABLED during GS mode - it overlays on top of the splat
        controls.getReactionHudManager()?.setEnabled(true);
        
        // Disable TikTokFeedUI (canvas-based)
        controls.getTikTokFeedUI()?.setEnabled(false);
        
        // Hide tutorial panels
        if (onboarding.isVisible()) {
          onboarding.hide();
        }
        
        // Hide lightweight engagement panel
        engagementPanel.detachFromAnchor();
        engagementPanel.hide();
        
        // Debug: Identify phantom panels
        if ((window as any).DEBUG_GS_SCENE) {
          setTimeout(() => {
            const suspects = debugGaussianSplatScene(app.scene, false);
            console.log('[Main] 🔍 Debug: Found', suspects.length, 'suspect meshes in GS mode');
          }, 500);
        }
      } else {
        // GAUSSIAN SPLAT INACTIVE: Re-enable multiplayer panel and standard UI
        logger.verbose('[Main] 🟢 Gaussian Splat inactive - re-enabling multiplayer panel and standard UI');
        
        // Re-enable multiplayer panel (for primitives and GLB models)
        xrMultiplayerPanel.setEnabled(true);
        xrMultiplayerPanel.show(); // Ensure it's visible
        
        // Re-enable ReactionHud
        controls.getReactionHudManager()?.setEnabled(true);
        
        // Re-enable TikTokFeedUI
        controls.getTikTokFeedUI()?.setEnabled(true);
        
        // Handle engagement panel for GLB models
        const contentKind = store.getContentKind();
        if (contentKind.isGlbModel) {
          const modelGroup = store.getCurrentModelGroup();
          if (modelGroup) {
            engagementPanel.attachToAnchor(modelGroup);
            engagementPanel.show();
            logger.verbose('[Main] 📱 Engagement panel attached to GLB model');
          }
        } else {
          engagementPanel.detachFromAnchor();
          engagementPanel.hide();
        }
        
        // Restore debug highlights if any
        restoreDebugHighlights(app.scene);
      }
    };
    
    // Initialize UI panels for current item
    const initialGsState = store.getGaussianSplatState();
    if (initialGsState !== null && (store as any).onGaussianSplatModeChange) {
      // GS active - disable panel
      (store as any).onGaussianSplatModeChange(true, initialGsState);
    } else if ((store as any).onGaussianSplatModeChange) {
      // Not GS - ensure panel is enabled
      (store as any).onGaussianSplatModeChange(false, null);
    }
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
      broadcastFeedSync('keyboard');
      break;
    
    case 'ArrowRight':
    case 'd':
      store.next(+1);
      hud.toast('➡️ Next item');
      broadcastFeedSync('keyboard');
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
      // REMOVED: XR is hand gesture only, no keyboard shortcuts
      // Multiplayer panel opens with hand gesture (peace sign or dedicated gesture)
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
