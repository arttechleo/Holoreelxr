# HoloreelXR v1.1.0 - Testing Guide 🧪

## Quick Start

### Access Your Headset
1. **Put on your Meta Quest**
2. **Open Quest Browser**
3. **Navigate to**: `https://arttechleo.github.io/Holoreelxr/` (or your deployment URL)
4. **Click "Enter VR"** or **"Enter AR"** button

---

## 🎹 Testing the New Keyboard

### Opening the Keyboard
1. **Make ILY gesture**: 
   - Extend index finger and pinky
   - Fold down middle, ring, and thumb
   - Hold for 1 second
2. **Watch for**:
   - Keyboard appears in front of you
   - 3D model fades to 50% opacity (blurred background)
   - Toast message: "Touch keys to type!"

### Testing Pinch-to-Touch
1. **Bring hand close** to a key
2. **Watch for hover effect**:
   - Key should scale up 1.1x
   - Emissive glow increases
3. **Pinch** (thumb + index finger together)
4. **Observe press animation**:
   - Key scales down (0.8x)
   - Flashes white
   - Bounces up (1.15x)
   - Returns to normal
5. **Try all key types**:
   - Letter keys (a-z)
   - Number keys (0-9)
   - Space bar (wide)
   - Backspace (⌫)
   - Enter (↵)
   - Cancel (red, ✕)
   - Post (blue, ✓)

### Testing Both Hands
1. **Left hand**: Try typing some letters
2. **Right hand**: Switch hands mid-word
3. **Both hands**: Alternate between hands
4. **Verify**: Both should work identically

### Testing Visual Feedback
1. **Hover without pinching**: Key should glow
2. **Move away**: Glow should fade
3. **Pinch on key**: Should see full press animation
4. **Pinch off key**: Should block but not crash

---

## 🌫️ Testing Background Blur

### During Typing
1. **Open keyboard**
2. **Observe 3D model**:
   - Should fade to 50% opacity
   - Remains visible but de-emphasized
   - Blur transition smooth (~200ms)
3. **Look around**: Model should stay blurred

### After Closing
1. **Hit Cancel** or **Post**
2. **Observe 3D model**:
   - Should return to 100% opacity
   - Smooth transition back
3. **Check performance**: No lag or stutter

---

## 🎯 Testing Dynamic UI

### Keyboard Following
1. **Open keyboard**
2. **Turn head left/right**:
   - Keyboard should follow gaze
   - Smooth motion (lerp 0.05)
   - Always faces camera
3. **Look up/down**:
   - Keyboard maintains comfortable height
   - Doesn't float too far
4. **Move around**:
   - Keyboard repositions naturally

### HUD Panels
1. **Look at 3D model** directly:
   - Icons on left
   - Comments on right
   - Close to model
2. **Look away** from model:
   - HUD panels should move further
   - Up to 30% distance increase
   - Smooth scaling transition
3. **Rotate model**:
   - HUD should rotate with model
   - Always face camera

---

## 🥽 Testing VR/MR Modes

### VR Mode (Immersive)
1. **Click "Enter VR"**
2. **Check background**: Should be dark blue (0x1a1a2e)
3. **Toast message**: "VR ready - Model placed in front of you"
4. **Console log**: Should show "XR Mode: VR"
5. **Test all features**: Keyboard, gestures, reactions

### MR Mode (Passthrough)
1. **Click "Enter AR"** (if available)
2. **Check background**: Should be transparent (null)
3. **Toast message**: "MR ready - Model placed in front of you"
4. **Console log**: Should show "XR Mode: MR"
5. **See real world**: Through headset
6. **Test all features**: Should work identically to VR

---

## 🚫 Testing Gesture Blocking

### While Keyboard Active
1. **Open keyboard**
2. **Try thumbs up**: Should be blocked (no "like" action)
3. **Try heart gesture**: Should be blocked
4. **Try peace sign**: Should be blocked (no "repost")
5. **Try ILY again**: Should be blocked (can't re-open)
6. **Try pinch + drag**: Should only type, not move model

### After Keyboard Closed
1. **Close keyboard** (Cancel or Post)
2. **Try thumbs up**: Should work (triggers "like")
3. **Try heart**: Should work (triggers "save")
4. **Try peace**: Should work (triggers "repost")
5. **Pinch + drag**: Should move/scale model

---

## 🎮 Testing Keyboard Shortcuts (Desktop)

Press these keys on your keyboard while in browser:

### Navigation
- `←` or `A`: Previous item
- `→` or `D`: Next item

### Transform
- `↑` or `W`: Zoom in
- `↓` or `S`: Zoom out
- `Q`: Rotate left
- `E`: Rotate right

### Reactions
- `L`: Like
- `H`: Heart/Save
- `R`: Repost

### Help
- `Shift+H`: Show keyboard shortcuts in console

---

## ✅ Checklist

### Core Functionality
- [ ] Keyboard opens with ILY gesture
- [ ] Keys respond to pinch/touch
- [ ] Hover feedback works on all keys
- [ ] Press animation smooth and satisfying
- [ ] Both hands work equally well
- [ ] Background blurs when typing
- [ ] Background restores after closing
- [ ] Keyboard follows gaze smoothly
- [ ] Cancel button exits keyboard
- [ ] Enter button adds new line
- [ ] Post button submits comment
- [ ] Backspace deletes characters
- [ ] Space bar works

### Mode Detection
- [ ] VR mode detected (dark blue background)
- [ ] MR mode detected (transparent background)
- [ ] Console shows correct mode
- [ ] Toast shows correct mode
- [ ] Features work in both modes

### Gesture Blocking
- [ ] Thumbs up blocked while typing
- [ ] Heart blocked while typing
- [ ] Peace blocked while typing
- [ ] ILY blocked while typing
- [ ] Pinch-drag blocked while typing
- [ ] All gestures work after closing

### Visual Quality
- [ ] Keyboard text crisp and readable
- [ ] Key symbols clear (␣, ⌫, ↵, ✓, ✕)
- [ ] No aliasing or blur on text
- [ ] HUD panels readable
- [ ] 3D model renders correctly
- [ ] No flickering or artifacts

### Performance
- [ ] Frame rate stable (72+ FPS)
- [ ] No lag when opening keyboard
- [ ] No lag when typing
- [ ] Smooth animations
- [ ] No memory leaks (10min test)
- [ ] Load time under 2 seconds

---

## 🐛 Known Issues to Watch For

### If You Experience These:
1. **Keyboard only types "6"**:
   - **Fixed in v1.1.0** - report if still occurs
   
2. **Can't exit keyboard**:
   - **Fixed in v1.1.0** - Cancel button added
   
3. **Gestures trigger while typing**:
   - **Fixed in v1.1.0** - comprehensive blocking added
   
4. **VR freezes**:
   - **Fixed in v1.1.0** - removed external window

### New Issues:
If you encounter any NEW bugs, please report:
- What you were doing
- What you expected to happen
- What actually happened
- Which mode (VR or MR)
- Browser version
- Headset model

---

## 📊 Expected Results

### Performance Metrics
- **Frame rate**: 72+ FPS consistently
- **Input latency**: <16ms (one frame)
- **Load time**: <2 seconds
- **Typing accuracy**: High (with hover preview)

### User Experience
- **Natural**: Feels like touching real keys
- **Responsive**: Immediate visual feedback
- **Smooth**: No jank or stutter
- **Clear**: All text readable
- **Intuitive**: No instructions needed

---

## 🎯 Success Criteria

**The experience is successful if:**
1. ✅ You can type naturally without frustration
2. ✅ Visual feedback feels satisfying
3. ✅ Background blur helps focus on typing
4. ✅ Keyboard follows your gaze comfortably
5. ✅ No crashes or freezes
6. ✅ Works equally well in VR and MR modes
7. ✅ Gestures don't interfere with typing
8. ✅ You feel this is a **product**, not a prototype

---

## 📝 Reporting Results

Please share:
1. **Overall impression**: 1-10 rating
2. **What worked well**
3. **What needs improvement**
4. **Any bugs encountered**
5. **Feature requests**

**Thank you for testing!** 🙏

Your feedback helps make HoloreelXR better for everyone.

