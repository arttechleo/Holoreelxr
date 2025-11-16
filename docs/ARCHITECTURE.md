# Architecture Overview

This document describes the high-level architecture and design decisions of Holoreelxr.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface Layer                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Hud.ts     │  │ ReactionHud  │  │   HTML/CSS   │      │
│  │  (2D Toast)  │  │ (3D Floating)│  │  (Compose)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Control & Logic Layer                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              FeedControls.ts                          │   │
│  │  - Gesture → Action mapping                          │   │
│  │  - Scroll, grab, transform logic                     │   │
│  │  - UI interaction (raycasting, dwell)                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
           │                │                │
           ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ HandEngine   │  │  FeedStore   │  │ ReactionHud  │
│   .ts        │  │    .ts       │  │  Manager.ts  │
│              │  │              │  │              │
│ Hand joint   │  │ Content      │  │ Per-model UI │
│ tracking +   │  │ management,  │  │ state,       │
│ gesture      │  │ transforms,  │  │ counts,      │
│ recognition  │  │ reactions    │  │ comments     │
└──────────────┘  └──────────────┘  └──────────────┘
           │                │
           ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                  Three.js & WebXR Layer                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              ThreeXRApp.ts                            │   │
│  │  - WebGL renderer setup                              │   │
│  │  - XR session management                             │   │
│  │  - Scene, camera, lighting                           │   │
│  │  - Animation loop                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Content Loaders                              │   │
│  │  - SplatSequence.ts (PLY point clouds)               │   │
│  │  - Shape generators                                   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. ThreeXRApp (Foundation)
**Responsibility**: WebXR session lifecycle, rendering loop, scene management

```typescript
class ThreeXRApp {
  renderer: WebGLRenderer     // Three.js renderer with XR enabled
  scene: Scene                // Root scene graph
  camera: PerspectiveCamera   // Main camera
  contentRoot: Group          // Container for feed content
  
  start()                     // Begin animation loop
  onFrame(callback)           // Register per-frame callback
  pause() / resume()          // Visibility change handling
}
```

**Key Decisions**:
- Uses `local-floor` reference space for room-scale VR/AR
- Manages hand model visualization (debug meshes)
- Handles session start/end events
- Provides overlay root for 2D DOM elements

### 2. HandEngine (Input Processing)
**Responsibility**: Raw hand tracking → structured gesture events

```typescript
class HandEngine {
  state: {
    left: { pinch: boolean }
    right: { pinch: boolean }
    heart: boolean
  }
  
  update(frame, refSpace)     // Process XRFrame for joint poses
  on(event, callback)         // Subscribe to gesture events
  thumbTip(side) → Vector3    // Helper to get joint position
  pinchMid(side) → Vector3
}
```

**Gesture Detection**:
- **Pinch**: thumb-tip ↔ index-tip distance < 3.5cm
- **Heart**: both hands' index+thumb tips < 4.5cm apart
- **Thumbs Up**: thumb extended, other fingers curled
- **ILY**: index + pinky + thumb extended, middle + ring curled
- **Peace**: index + middle extended, ring + pinky curled

**Smoothing**: Uses history buffer (4 frames) + settle time (100ms) to debounce noise

### 3. FeedControls (Application Logic)
**Responsibility**: Translate gestures into app actions, manage interactions

**State Machines**:
1. **Scroll**: armed → tracking → cooldown
2. **Grab**: pending → holding → placed
3. **Two-hand transform**: inactive → active (pinch both) → applying scale/rotation

**Ray Visualization**: Shows dashed line from pinch to object (visual feedback)

**UI Interaction**:
- Raycast from hand → HUD panels
- Dwell detection (camera → index finger, 350ms)
- WebXR select events (controller button/pinch)

### 4. FeedStore (Content Management)
**Responsibility**: Feed data, content loading, spatial placement, reactions

```typescript
class FeedStore {
  items: Item[]               // Feed content array
  index: number               // Current item
  
  loadFeed(url)               // Fetch feed.json
  showCurrent()               // Display current item
  next(delta)                 // Navigate feed
  setPosition(worldPos)       // Place content in space
  setTransform(scale, rotY)   // Adjust appearance
  
  // Reactions
  likeCurrent()
  saveCurrent()
  repostCurrent()
}
```

**Content Types**:
- `shape`: Procedural geometry (box, sphere, pyramid)
- `ply`: Static PLY point cloud
- `splat4d`: Animated PLY sequence (frame-by-frame)
- `mesh`: Generic 3D mesh (extensible)

**Visual Effects**:
- Platform pulse (expanding ring) on reactions
- Emoji projectiles (canvas sprite → target)
- Transform interpolation (smooth scale/rotation)

### 5. ReactionHud (3D UI)
**Responsibility**: Floating canvas-based panel for reactions and comments

**Layout**:
```
┌─────────────────────────────────┐
│  Reactions            Comments  │
│  [❤️ 23] [👍 45]      [Scroll] │
│  [🔁 12]              ┌────────┐│
│                       │Comment ││
│                       │bubbles ││
│                       └────────┘│
│                       [Post]    │
└─────────────────────────────────┘
```

**Rendering**: High-res canvas (1152×640) → WebGL texture → plane mesh

**Interaction**:
- Raycast against plane in world space
- Convert hit point → canvas pixel coords
- Test against button/region bounding boxes

**Positioning**: Follows object with fixed offset (0, +0.22m, 0), no rotation

## Data Flow

### Gesture to Action Example: "Heart Gesture"

```
1. XRFrame provides joint poses
   └→ HandEngine.update()
   
2. Calculate distances: left.index-tip ↔ right.index-tip
                       left.thumb-tip ↔ right.thumb-tip
   └→ If both < 4.5cm, gesture detected
   
3. Smooth over 4 frames, settle for 100ms
   └→ Emit 'heartstart' event
   
4. FeedControls receives event
   └→ Check anti-burst (hands not clustered)
   └→ Check stable hold (120ms)
   └→ Check cooldown (800ms since last)
   
5. If passed, trigger action
   └→ store.saveCurrent()
   └→ hudMgr.bump('heart')
   
6. FeedStore animates effects
   └→ Platform pulse (red)
   └→ Emoji particle launched
   └→ Toast notification
   
7. ReactionHudManager updates UI
   └→ Increment heart count
   └→ Flash "+1 ❤️" chip
   └→ Redraw canvas texture
```

## Design Patterns

### 1. Event Bus (HandEngine)
Decouples gesture detection from application logic
```typescript
hands.on('thumbsupstart', () => { /* handle */ });
```

### 2. Manager Pattern (ReactionHudManager)
Manages per-model state for a single HUD instance
```typescript
hudMgr.showFor(modelKey);  // Switch context
hudMgr.bump(modelKey, 'like');  // Update specific model
```

### 3. State Machine (FeedControls)
Explicit state transitions for grab/scroll/transform
```
pinchStart → grabPending → grabbing → placed
              (150ms)      (pinchEnd)
              (or cancel if moved > 6cm)
```

### 4. Object Pool (Particles)
Reuse sprite objects to avoid GC pressure (future optimization)

### 5. Low-Pass Filter
Smooth noisy sensor data (hand positions, distances)
```typescript
filteredValue = filteredValue + (newValue - filteredValue) * alpha
```

## Extension Points

### Adding a New Gesture

1. **Define detection** in `HandEngine.ts`:
```typescript
const swipeRight = (side: Side) => {
  const vel = calculateHandVelocity(side);
  return vel.x > 1.0 && Math.abs(vel.y) < 0.3;
};
if (swipeRight('right')) this.emit('swiperightstart', {side: 'right'});
```

2. **Handle event** in `FeedControls.ts`:
```typescript
this.hands.on('swiperightstart', () => {
  this.store.next(+1);  // Skip to next item
});
```

### Adding a New Content Type

1. **Define type** in `FeedStore.ts`:
```typescript
type Item = 
  | { type: 'gltf'; src: string; ... }
  | /* existing types */
```

2. **Implement loader**:
```typescript
if (item.type === 'gltf') {
  const gltfLoader = new GLTFLoader();
  const gltf = await gltfLoader.loadAsync(item.src);
  this.parent.add(gltf.scene);
}
```

3. **Update feed.json schema** in README

### Adding Network Backend

Replace local feed with API:
```typescript
async loadFeed(url = '/api/feed') {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  this.items = await res.json();
}
```

## Performance Considerations

See [PERFORMANCE.md](./PERFORMANCE.md) for detailed optimizations.

**Key Points**:
- Hand tracking runs at 60-90 Hz → minimize allocations
- Canvas redraws are expensive → only redraw on state change
- Geometry disposal is critical → use `dispose()` when removing content
- Smooth interpolation avoids jarring updates → lerp/exponential decay

## Testing Strategy

**Current**: Manual testing on Quest/desktop

**Future**:
- Unit tests for gesture detection logic (mock joint poses)
- Integration tests for feed navigation
- E2E tests with WebXR emulator
- Performance benchmarks (frame time, memory usage)

## Security Considerations

1. **Content Safety**: Validate feed.json schema to prevent XSS
2. **HTTPS Required**: WebXR only works over secure contexts
3. **CORS**: Asset URLs must allow cross-origin requests
4. **Input Validation**: Sanitize user comments before display

## Future Architecture

### Phase 2: Multiplayer
- WebSocket connection for real-time presence
- Networked avatar hands (other users visible)
- Shared reactions (see others' likes in real-time)

### Phase 3: Spatial Audio
- 3D audio sources attached to content
- Voice chat for comments

### Phase 4: AI Integration
- Gesture prediction (anticipate user intent)
- Content recommendations
- Automated moderation

---

**Last Updated**: 2024-11-16  
**Version**: 1.0.0

