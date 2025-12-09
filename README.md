# HoloreelXR - Immersive 3D Social Feed

**HoloreelXR** is a cutting-edge WebXR application that transforms social media into an immersive 3D experience. Browse animated 3D models, Gaussian Splats, and interactive content using natural hand gestures in Augmented Reality (AR) and Virtual Reality (VR).

## 🌟 What is HoloreelXR?

HoloreelXR is a TikTok-style social feed viewer built for WebXR devices like Meta Quest, HoloLens, and other AR/VR headsets. Instead of scrolling through flat images and videos, you interact with 3D content floating in your space using intuitive hand gestures—no controllers needed.

### Key Highlights

- **🎮 Hand Tracking**: Control everything with natural hand gestures
- **🎨 3D Content**: View GLB/GLTF models, Gaussian Splats, and animated sequences
- **🌐 WebXR**: Works on any WebXR-compatible device via browser
- **👥 Multiplayer**: Real-time collaboration with hand tracking sync
- **✨ Mixed Reality**: Seamless AR/VR mode switching

## ✨ Features

### Hand Gesture Controls

| Gesture | Action | Description |
|---------|--------|------------|
| 👍 **Thumbs Up** | Like | Quick like gesture with visual feedback |
| ❤️ **Heart Gesture** | Save/Favorite | Bring both index and thumb tips together |
| ✌️ **Peace Sign** | Repost/Share | Two-finger peace gesture |
| 🤏 **Pinch** | Scroll & Grab | Pinch and move vertically to scroll feed, pinch near objects to grab |
| ✋ **Two-Hand Pinch** | Scale & Rotate | Use both hands to resize and rotate 3D content |
| 🤟 **ILY Gesture** | Comment | Open virtual keyboard to compose comments |

### 3D Content Support

- **GLB/GLTF Models**: Animated 3D models with full animation playback
- **Gaussian Splats**: High-quality point cloud scenes (PLY files)
- **Animated Sequences**: 4D splat sequences with frame-by-frame playback
- **Basic Shapes**: Interactive 3D primitives (box, sphere, pyramid)

### Immersive UI

- **Mixed Reality HUD**: Floating panels with reaction counts and engagement stats
- **TikTok-Style Feed**: Vertical scrolling through 3D content
- **Visual Feedback**: Particle effects, platform pulses, and smooth animations
- **Ray-Based Interaction**: Point at UI elements with your finger to interact
- **Virtual Keyboard**: Pinch-to-touch keyboard for text input in XR

### Multiplayer Features

- **Real-Time Hand Sync**: See other users' hands in your space
- **Feed Synchronization**: Share the same feed position with others
- **Voice Chat**: Integrated voice communication (experimental)
- **Collaborative Viewing**: Experience content together in real-time

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+** and npm
- **WebXR-Compatible Device**:
  - Meta Quest 2/3/Pro (recommended)
  - HoloLens 2
  - Any device with WebXR support
- **HTTPS**: Required for WebXR (dev server includes HTTPS)

### Installation

```bash
# Clone the repository
git clone https://github.com/arttechleo/Holoreelxr.git
cd Holoreelxr

# Install dependencies
npm install

# Start development server with HTTPS
npm run dev
```

The development server will start at `https://localhost:5173`. For headset access, use your local IP address (e.g., `https://192.168.1.100:5173`).

### Building for Production

```bash
# Build optimized production bundle
npm run build

# Preview production build
npm run preview
```

## 🎮 How to Use

### Desktop/2D Mode

1. Open the application in a modern browser
2. You'll see the **Holoreel logo** and **Enter AR** button
3. Click **Enter AR** to start an immersive session

### AR/VR Mode

#### First Time Setup

1. **Enter AR/VR**: Click the "Enter AR" button or use the XR bar controls
2. **Onboarding Tutorial**: Complete the interactive tutorial to learn gestures
3. **Grant Permissions**: Allow hand tracking when prompted

#### Navigation

- **Scroll Feed**: Pinch with one hand and move vertically up/down
- **Next/Previous Item**: Swipe left/right with pinch gesture
- **Scale Content**: Pinch with both hands and move apart/together
- **Rotate Content**: Use two-hand pinch and rotate hands

#### Interactions

- **Like**: Make a thumbs-up gesture
- **Save/Favorite**: Bring both index and thumb tips together (heart gesture)
- **Repost**: Make a peace sign (✌️)
- **Comment**: Make ILY gesture (🤟) to open keyboard
- **Grab & Move**: Pinch near a 3D object and move your hand to reposition it

#### UI Interaction

- **Point at UI**: Extend your index finger toward UI panels
- **Activate Buttons**: Dwell on buttons for 350ms to click
- **Virtual Keyboard**: Touch keys with your fingertips (3cm proximity)

### Desktop Testing (Without Headset)

Press **Shift+H** to see keyboard shortcuts:

| Key | Action |
|-----|--------|
| **←** / **A** | Previous item |
| **→** / **D** | Next item |
| **↑** / **W** | Zoom in |
| **↓** / **S** | Zoom out |
| **Q** | Rotate left |
| **E** | Rotate right |
| **L** | Like |
| **H** | Heart/Save |
| **R** | Repost |

## 📁 Project Structure

```
src/
├── app/
│   └── ThreeXRApp.ts          # WebXR renderer & scene management
├── controls/
│   └── FeedControls.ts        # Gesture-based interaction logic
├── feed/
│   ├── FeedStore.ts           # Content management & state
│   └── loaders/               # GLB, PLY, and splat loaders
├── gestures/
│   └── HandEngine.ts          # Hand tracking & gesture recognition
├── ui/
│   ├── ReactionHud.ts         # 3D floating UI panels
│   ├── TikTokFeedUI.ts        # Feed UI overlay
│   └── XRMultiplayerPanel.ts  # Multiplayer controls
├── multiplayer/
│   ├── MultiplayerManager.ts  # Real-time sync
│   └── RemoteHands.ts         # Remote hand visualization
└── main.ts                    # Application entry point
```

## 🔧 Configuration

### Feed Content

Edit `public/feed.json` to customize your feed:

```json
[
  {
    "id": "unique-id",
    "title": "Content Title",
    "author": "creator-name",
    "type": "glb",
    "src": "/assets/feeddata/model.glb"
  },
  {
    "id": "world-01",
    "title": "World 1",
    "author": "FeedData",
    "type": "gaussianSplat",
    "src": "/assets/feeddata/world1.ply"
  }
]
```

**Supported Content Types:**

- `glb` / `gltf` - 3D models with animations
- `gaussianSplat` - Gaussian Splat point clouds (PLY files)
- `shape` - Basic 3D shapes (box, sphere, pyramid)
- `splat4d` - Animated PLY sequences (experimental)

### Gesture Tuning

Adjust gesture sensitivity in `src/gestures/HandEngine.ts`:

- `pinchThreshold`: Distance for pinch detection (default: 0.035m)
- `heartThreshold`: Distance for heart gesture (default: 0.045m)

## 🛠️ Tech Stack

- **Three.js 0.181** - 3D rendering engine
- **WebXR Device API** - AR/VR support
- **@sparkjsdev/spark** - Gaussian Splat rendering
- **@mkkellogg/gaussian-splats-3d** - Alternative splat renderer
- **Vite 7.2** - Build tool & dev server
- **TypeScript** - Type safety
- **PeerJS** - Multiplayer networking

## 🐛 Troubleshooting

### Canvas Not Hiding on Index Page

The canvas is automatically hidden on the landing page. If you see 3D content before entering AR:

1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
3. Check browser console for errors

### Hand Tracking Not Working

1. Ensure WebXR hand tracking is enabled in your device settings
2. Grant hand tracking permissions when prompted
3. Check that your device supports hand tracking (Quest 2+ required)

### Content Not Loading

1. Check browser console for error messages
2. Verify file paths in `feed.json` are correct
3. Ensure assets exist in `public/assets/` directory
4. Check network tab for failed requests

### Performance Issues

- Lower framebuffer scale in `src/app/ThreeXRApp.ts` (default: 0.75)
- Reduce pixel ratio for mobile XR devices
- Disable MSAA on Quest devices (already optimized)

## 📝 Development

### Adding New Gestures

1. Define gesture detection in `src/gestures/HandEngine.ts`:

```typescript
const myGesture = (side: Side) => {
  const W = J(side, 'wrist');
  const T = J(side, 'thumb-tip');
  // Your detection logic
  return isGestureActive;
};
```

2. Emit events when gesture is detected
3. Handle in `src/controls/FeedControls.ts`

### Adding Content to Feed

1. Place assets in `public/assets/feeddata/`
2. Add entry to `public/feed.json`:

```json
{
  "id": "my-content",
  "title": "My 3D Model",
  "author": "Creator",
  "type": "glb",
  "src": "/assets/feeddata/my-model.glb"
}
```

3. Maintain GLB → PLY alternating pattern for best experience

## 📄 License

ISC

## 🤝 Contributing

Contributions are welcome! Please ensure:

- TypeScript compiles without errors (`npm run lint`)
- Code follows existing style conventions
- Test on at least one WebXR device
- Update documentation for new features

## 🔗 Resources

- [WebXR Device API](https://immersiveweb.dev/)
- [Three.js Documentation](https://threejs.org/docs/)
- [Hand Tracking in WebXR](https://immersiveweb.dev/webxr-hand-input/)
- [Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)

---

**Built with ❤️ for the future of immersive social media**
