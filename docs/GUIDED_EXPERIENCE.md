# 🎮 HoloreelXR - Guided Experience

Welcome to HoloreelXR! This step-by-step guide will walk you through all the key features of the platform.

## 🚀 Getting Started

### Step 1: Enter Mixed Reality
1. Open the app in a WebXR-compatible browser (Oculus Browser, Chrome, Edge)
2. Click **"Enter AR"** or **"Enter VR"** button
3. Allow hand tracking permissions when prompted
4. The experience will begin with an onboarding tutorial

---

## 📚 Onboarding Tutorial

The tutorial introduces you to the core gestures:

### Step 1: Welcome
- **Duration**: 3 seconds (auto-advances)
- **What you see**: A red sphere appears
- **Purpose**: Introduction to the platform

### Step 2: Pinch Gesture
- **Gesture**: Pinch your thumb and index finger together
- **What you see**: A cyan box appears
- **Purpose**: Learn the basic interaction gesture
- **Tip**: Try with either hand - both work!

### Step 3: Scroll Gesture
- **Gesture**: Pinch and move your hand up/down
- **What you see**: A green pyramid appears
- **Purpose**: Learn to navigate through content
- **Tip**: Keep your hand away from the object to scroll

### Step 4: Thumbs Up (Like)
- **Gesture**: Extend your thumb, curl other fingers
- **What you see**: A pink sphere appears
- **Purpose**: Learn to like content
- **Tip**: Make sure your thumb is clearly extended

### Step 5: Heart Gesture
- **Gesture**: Touch index fingers together AND thumbs together (both hands)
- **What you see**: A purple box appears
- **Purpose**: Learn to save/favorite content
- **Tip**: Both index fingers and both thumbs must touch

---

## 🎯 Core Features

### 1. Navigating the Feed

#### Scroll Through Content
- **Gesture**: Pinch with one hand and move up/down
- **Distance**: Keep your hand at least 0.6m away from the object
- **Visual Feedback**: A dotted green line shows your scroll ray
- **Tip**: The further your hand, the easier it is to scroll

#### Jump to Next/Previous
- **Desktop**: Press `←` / `→` or `A` / `D` keys
- **XR**: Use scroll gesture (see above)

---

### 2. Interacting with 3D Models

#### Grab and Move
- **Gesture**: Pinch near the object (within 0.15m)
- **What happens**: Object follows your hand
- **Release**: Release pinch to place the object
- **Visual Feedback**: Object highlights when grabbable

#### Rotate Content
- **Gesture**: Pinch with both hands and rotate
- **What happens**: Object rotates around Y-axis
- **Tip**: Keep both hands pinched while rotating

#### Scale Content
- **Gesture**: Pinch with both hands and move closer/farther
- **What happens**: Object scales up/down
- **No Limits**: Scale as large or small as you want!
- **Tip**: Move hands together to scale down, apart to scale up

---

### 3. Reactions

#### Like (Thumbs Up) 👍
- **Gesture**: Extend thumb, curl other fingers
- **Visual Feedback**: Yellow 👍 emoji particle appears
- **UI Update**: Like count increases on HUD
- **Cooldown**: 800ms between likes

#### Heart (Save/Favorite) ❤️
- **Gesture**: Touch index fingers together AND thumbs together (both hands)
- **Visual Feedback**: Red ❤️ emoji particle appears
- **UI Update**: Heart count increases on HUD
- **Cooldown**: 800ms between hearts
- **Tip**: Both conditions must be met simultaneously

#### Repost (Peace Sign) ✌️
- **Gesture**: Extend index and middle fingers, curl others
- **Visual Feedback**: Blue 🔁 emoji particle appears
- **UI Update**: Repost count increases on HUD
- **Cooldown**: 800ms between reposts

---

### 4. UI Interactions

#### Reaction HUD
- **Location**: Left side of the 3D model (vertically stacked)
- **Icons**: Heart ❤️, Like 👍, Repost 🔁
- **Interaction**: Pinch on icons to trigger reactions
- **Visual Feedback**: Icons highlight when hovered

#### TikTok-Style Feed UI
- **Location**: Below the 3D model
- **Shows**: Creator name, title, stats
- **Auto-positions**: Always faces the camera

---

### 5. Content Types

#### Geometric Shapes
- **Types**: Sphere, Box, Pyramid
- **Colors**: Customizable per item
- **Use**: Tutorial and testing

#### GLTF/GLB Models
- **Formats**: `.gltf` and `.glb` files
- **Sources**: Sketchfab, Animated.xyz, Stale.art, or direct links
- **Features**: 
  - Auto-scaling to fit view
  - Animation support (if included)
  - Auto-centering

#### PLY Point Clouds
- **Format**: `.ply` files
- **Use**: Point cloud visualization
- **Features**: High-quality point rendering

#### Splat4D Sequences
- **Format**: Multiple `.ply` frames
- **Use**: Animated point cloud sequences
- **Features**: Frame-by-frame animation playback

---

### 6. Adding Your Own Content

#### Method 1: Edit feed.json
1. Open `public/feed.json`
2. Add a new item:
   ```json
   {
     "id": "my-model",
     "title": "My 3D Model",
     "author": "My Name",
     "type": "glb",
     "src": "https://example.com/model.glb"
   }
   ```
3. Save and reload

#### Method 2: Use Asset Link UI (Desktop)
1. Click the asset link input field
2. Paste a URL to a `.glb` or `.gltf` file
3. Press Enter
4. Model loads automatically

---

### 7. Keyboard Shortcuts (Desktop)

#### Navigation
- `←` / `A` - Previous item
- `→` / `D` - Next item

#### Transform
- `↑` / `W` - Zoom in
- `↓` / `S` - Zoom out
- `Q` - Rotate left
- `E` - Rotate right

#### Reactions
- `L` - Like
- `H` - Heart/Save
- `R` - Repost

#### Media
- `P` - Play audio

#### Help
- `Shift + H` - Show keyboard shortcuts (console)

---

## 🎨 Visual Feedback

### Gesture Detection
- **Emoji Particles**: Single emoji appears when gesture is detected
- **Colors**: 
  - 👍 Yellow (Like)
  - ❤️ Red (Heart)
  - 🔁 Blue (Repost)

### Interaction Rays
- **Scroll Ray**: Dotted green line when scrolling
- **Grab Ray**: Solid line when near object
- **UI Ray**: Dashed line when pointing at UI

### HUD Updates
- **Count Increments**: Numbers update in real-time
- **Flash Animation**: "+1" indicator appears briefly
- **Icon Highlights**: Icons glow when hovered

---

## ⚠️ Troubleshooting

### Gestures Not Detected
- **Check**: Are your hands in the camera frame?
- **Rule**: Gestures only work when hands are visible
- **Tip**: Move hands into view before making gesture

### Heart Gesture Not Working
- **Check**: Are both index fingers touching?
- **Check**: Are both thumbs touching?
- **Check**: Are both hands in frame?
- **Tip**: All conditions must be met simultaneously

### Content Not Loading
- **Check**: Is the URL publicly accessible?
- **Check**: Does the URL have CORS headers?
- **Check**: Is the file format supported?
- **Tip**: Test the URL in a browser first

### Tutorial Freezes
- **Auto-Skip**: Tutorial auto-advances after 30 seconds
- **Workaround**: Reload the page to restart
- **Tip**: Make sure hands are clearly visible

### Scrolling Not Working
- **Check**: Is your hand far enough from the object? (0.6m+)
- **Check**: Are you pinching?
- **Tip**: Move hand further away if too close

---

## 💡 Pro Tips

1. **Use Both Hands**: Many gestures work with either hand
2. **Take Your Time**: Gestures need to be held for 150ms
3. **Clear Gestures**: Make gestures clearly and deliberately
4. **Hand Position**: Keep hands in camera frame
5. **Distance Matters**: 
   - Close to object (< 0.15m) = Grab
   - Medium distance (0.15-0.6m) = No action
   - Far from object (> 0.6m) = Scroll

---

## 🎯 Best Practices

### For Gestures
- Make gestures clearly and hold them
- Ensure hands are fully in frame
- Avoid rapid gestures (cooldown is 800ms)
- One gesture at a time works best

### For Navigation
- Use scroll for smooth browsing
- Use keyboard shortcuts on desktop for quick jumps
- Grab objects to reposition them
- Use two-hand gestures for precise control

### For Content
- Add models from trusted sources
- Test URLs before adding to feed
- Use HTTPS URLs for security
- Keep file sizes reasonable (< 50MB recommended)

---

## 🚀 Advanced Features

### Two-Hand Transform
- **Scale**: Pinch both hands, move closer/farther
- **Rotate**: Pinch both hands, rotate around object
- **Precision**: More control than single-hand gestures

### Auto-Positioning
- Objects automatically position 1.0m in front of you
- Height: 0.5m above ground
- Auto-faces camera on load

### Animation Support
- GLTF models with animations play automatically
- Multiple animations supported
- Loops continuously

---

## 📖 Additional Resources

- **Adding Assets**: See `docs/ADDING_ASSETS.md`
- **Architecture**: See `docs/ARCHITECTURE.md`
- **Keyboard Shortcuts**: Press `Shift + H` in console

---

## 🎉 Enjoy!

You're now ready to explore HoloreelXR! Start with the onboarding tutorial, then browse through the feed and interact with 3D content using natural hand gestures.

**Remember**: Gestures only work when your hands are in the camera frame!

