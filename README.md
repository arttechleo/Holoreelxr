# Holoreelxr - WebXR Social Feed Viewer

An immersive 3D social media feed viewer built with Three.js and WebXR, featuring advanced hand gesture controls for intuitive interactions in AR/VR.

## ✨ Features

- **Hand Gesture Recognition**
  - 👍 **Thumbs Up** - Like content
  - ❤️ **Heart Gesture** - Save/favorite (two hands together)
  - ✌️ **Peace Sign** - Repost/share
  - 🤟 **ILY Gesture** - Open comment composer
  - 🤏 **Pinch** - Scroll feed, grab & move objects
  - ✋ **Two-Hand Gestures** - Scale and rotate content

- **3D Content Support**
  - PLY point cloud files
  - Animated splat sequences (4D content)
  - Basic 3D shapes (box, sphere, pyramid)

- **Immersive UI**
  - Mixed reality HUD with reaction counts
  - Floating comment panels
  - Visual feedback with particles and effects
  - Ray-based interaction helpers

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and npm
- WebXR-compatible device (Meta Quest, HoloLens, etc.) or browser
- HTTPS-enabled local network (required for WebXR)

### Installation

```bash
# Install dependencies
npm install

# Start development server with HTTPS
npm run dev
```

The dev server will be available at `https://localhost:5173` (or your local IP for Quest/other devices).

### Building for Production

```bash
npm run build
npm run preview
```

## 🎮 Controls

### Desktop/2D Mode
- Use the **Enter AR** or **Enter VR** buttons to start an immersive session

### AR/VR Mode

#### Navigation
- **Single pinch + vertical movement** - Scroll through feed items
- **Two-hand pinch** - Scale and rotate content

#### Interactions
- **Pinch on UI panel** - Click reaction buttons
- **Thumbs up** - Quick like
- **Heart gesture** (both index + thumb tips together) - Save/favorite
- **Peace sign** - Repost
- **ILY gesture** - Open comment composer
- **Pinch + hold near object** - Grab and reposition

#### UI Raycasting
- Point at UI elements with index finger from camera view
- Dwell for 350ms to activate buttons

## 📁 Project Structure

```
src/
├── app/
│   └── ThreeXRApp.ts          # Main WebXR renderer & scene management
├── controls/
│   └── FeedControls.ts        # Gesture-based interaction logic
├── feed/
│   ├── FeedStore.ts           # Content management & state
│   └── loaders/
│       └── SplatSequence.ts   # PLY/splat loader with animation
├── gestures/
│   ├── HandEngine.ts          # Hand tracking & gesture recognition
│   └── StopPalmGesture.ts     # Additional gesture patterns
├── integrations/
│   └── player.ts              # Global audio player
├── ui/
│   ├── Hud.ts                 # 2D overlay HUD
│   ├── ReactionHud.ts         # 3D floating UI panel
│   └── ReactionHudManager.ts  # Per-model UI state management
└── main.ts                    # Application entry point
```

## 🔧 Configuration

### Feed Content

Edit `public/feed.json` to customize the feed:

```json
[
  {
    "id": "unique-id",
    "title": "Content Title",
    "author": "creator-name",
    "type": "splat4d",
    "fps": 30,
    "frames": ["/assets/500/frame_0000.ply", "..."]
  }
]
```

**Supported types:**
- `shape` - Basic 3D shapes (box, sphere, pyramid)
- `ply` - Static PLY point cloud
- `splat4d` - Animated PLY sequence
- `mesh` - Generic 3D mesh (placeholder)

### Gesture Tuning

Adjust gesture thresholds in `src/gestures/HandEngine.ts`:
- `pinchThreshold`: Distance for pinch detection (default: 0.035m)
- `heartThreshold`: Distance for heart gesture (default: 0.045m)

## 🛠️ Development

### Tech Stack
- **Three.js** 0.181 - 3D rendering
- **Vite** 7.2 - Build tool & dev server
- **TypeScript** - Type safety
- **WebXR Device API** - Immersive experiences

### Adding New Gestures

1. Define gesture detection in `HandEngine.ts`:
```typescript
const myGesture = (side: Side) => {
  const W = J(side, 'wrist');
  const T = J(side, 'thumb-tip');
  // ... your logic
  return isGestureActive;
};
```

2. Emit events:
```typescript
if (myGesture('left')) this.emit('mygesturestart', {side: 'left'});
```

3. Handle in `FeedControls.ts`:
```typescript
this.hands.on('mygesturestart', () => {
  // Your action
});
```

## 🐛 Known Issues

- **Audio player**: `/assets/track.mp3` is referenced but not included
- **Compose keyboard**: Uses fallback `prompt()` without native XR keyboard
- **Quest Browser**: Some runtimes may need WebXR Emulator extension for testing

## 📝 License

ISC

## 🤝 Contributing

Contributions welcome! Please ensure:
- TypeScript compiles without errors
- Code follows existing style conventions
- Test on at least one WebXR device

## 📚 Documentation

- **[Adding Assets Guide](docs/ADDING_ASSETS.md)** - Learn how to add 3D model links to your feed (`public/feed.json`)
- See `docs/` directory for detailed architecture and development guides

## 🔗 Resources

- [WebXR Device API Spec](https://immersiveweb.dev/)
- [Three.js Documentation](https://threejs.org/docs/)
- [Hand Tracking in WebXR](https://immersiveweb.dev/webxr-hand-input/)

