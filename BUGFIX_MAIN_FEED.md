# Main Feed Bug Fixes

## Overview
This document summarizes the bug fixes applied to address persistent issues with the main feed experience.

## Issues Fixed

### 1. ✅ Scroll Triggering During Rotation/Scaling
**Problem:** When rotating or scaling 3D models with two-hand gestures, scrolling was inadvertently triggered, causing the next model to appear.

**Solution:** 
- Added comprehensive scroll state reset when entering two-hand transform mode
- Scroll is now immediately disarmed when both hands are pinching (two-hand mode)
- Added state cleanup when exiting two-hand mode to prevent residual scroll triggers
- Scroll accumulation is cleared at all transition points

**Files Modified:**
- `src/controls/FeedControls.ts`

**Changes:**
```typescript
// In updateScroll():
if (this.twoHandActive) {
  // Reset ALL scroll state to prevent any scroll triggering
  this.scrollArmed = false;
  this.scrollDisarmedThisPinch = true;
  this.scrollAccum = 0;
  this.lastPinchY = null;
  this.filtPinchY = null;
  if (this.scrollRay) this.scrollRay.visible = false;
  return;
}

// In updateTwoHandTransform():
if (!this.twoHandActive) {
  this.twoHandActive = true;
  // ... existing setup code ...
  // CRITICAL: Immediately disarm scroll when entering two-hand mode
  this.scrollArmed = false;
  this.scrollDisarmedThisPinch = true;
  // ... reset all scroll state ...
}
```

---

### 2. ✅ Improved Model Scaling for Better Screen Fit
**Problem:** Some 3D models were not scaled correctly to fit the user's POV, appearing too large or extending outside the field of view.

**Solution:**
- Reduced target size from 0.5m (50cm) to 0.4m (40cm) for largest model dimension
- This ensures models fit comfortably within the user's POV at arm's reach (~60cm from face)
- Models remain large enough to see details but small enough to view without head movement

**Files Modified:**
- `src/feed/FeedStore.ts`

**Changes:**
```typescript
// Changed TARGET_SIZE from 0.5 to 0.4
const TARGET_SIZE = 0.4; // 40cm for largest dimension
```

---

### 3. ✅ Feed Simplified to 3 Basic Shapes
**Problem:** Too many tutorial shapes with different colors cluttered the feed, making it difficult to test loaded 3D models.

**Solution:**
- Removed all 7 tutorial shapes (tutorial-rotate, tutorial-scale, tutorial-grab, etc.)
- Kept only the 3 requested basic shapes:
  - **Blue Cube** (#0080FF)
  - **Yellow Pyramid** (#FFD700)
  - **Red Sphere** (#FF0000)
- All GLTF/GLB 3D models remain in the feed (22 models)

**Files Modified:**
- `public/feed.json`

**Before:** 32 items (7 tutorial shapes + 3 basic shapes + 22 3D models)  
**After:** 25 items (3 basic shapes + 22 3D models)

---

### 4. ✅ Fixed Left Hand Raycast Visibility
**Problem:** Left hand raycast was sometimes not visible/working, preventing interaction with 3D objects.

**Solution:**
- Improved raycast visibility logic to treat both hands equally
- Ray now only hides in specific cases:
  1. Two-hand transform mode (both hands working together)
  2. Hand is actively grabbing an object
  3. User is composing in HUD
- Left hand ray now always shows when pinching (unless in above cases)
- Removed logic that was hiding left hand ray during right hand scroll

**Files Modified:**
- `src/controls/FeedControls.ts`

**Changes:**
```typescript
// Simplified and fixed ray visibility logic
// Hide if two-hand mode active
if (this.twoHandActive) {
  line.visible = false;
  return;
}

// Hide if this specific hand is grabbing
if (this.grabbing && this.grabSide === side) {
  line.visible = false;
  return;
}

// Show ray for both hands equally
const show = pinching && !this.hudMgr.isComposing() && 
  !(this.scrollDisarmedThisPinch && this.scrollSide === side);
```

---

### 5. ✅ Enhanced Heart Gesture Detection
**Problem:** Heart emoji hand tracking was unreliable and needed improvement based on actual hand heart shape reference.

**Solution:**
- Redesigned heart gesture detection with 3 detection modes:
  1. **Strict Mode:** Classic heart - both index fingers AND thumbs close together
  2. **Relaxed Mode:** At least one pair (index or thumb) very close
  3. **Shape Mode:** Hands form heart-like configuration (all fingertips close to center point)
- Tuned thresholds for more reliable detection:
  - `HEART_THRESHOLD`: 0.20m → 0.12m (stricter for better accuracy)
  - `HEART_COMBINED_THRESHOLD`: 0.25m → 0.15m (tuned for shape detection)
- Added geometric validation using center point calculation
- Improved debug logging for troubleshooting

**Files Modified:**
- `src/gestures/HandEngine.ts`
- `src/config/constants.ts`

**Changes:**
```typescript
// New shape-based detection
const centerX = (L_i.x + R_i.x + L_t.x + R_t.x) / 4;
const centerY = (L_i.y + R_i.y + L_t.y + R_t.y) / 4;
const centerZ = (L_i.z + R_i.z + L_t.z + R_t.z) / 4;
const center = new THREE.Vector3(centerX, centerY, centerZ);

const maxDistFromCenter = Math.max(
  center.distanceTo(L_i),
  center.distanceTo(R_i),
  center.distanceTo(L_t),
  center.distanceTo(R_t)
);
const shapeHeart = maxDistFromCenter < GESTURE.HEART_COMBINED_THRESHOLD * 0.8;

// Combined detection
const heartNow = strictHeart || (oneVeryClose && shapeHeart) || (indexClose && thumbClose);
```

---

## Testing Recommendations

### 1. Two-Hand Gestures
- ✅ Rotate model with two hands → scroll should NOT trigger
- ✅ Scale model with two hands → scroll should NOT trigger
- ✅ Release one hand after scaling → scroll should still be disabled for that gesture
- ✅ Start new pinch gesture after two-hand mode → scroll should work normally

### 2. Model Scaling
- ✅ Load various 3D models (small to large)
- ✅ Verify models fit comfortably in POV at arm's reach
- ✅ Check that no model extends significantly outside field of view
- ✅ Ensure models are large enough to see details

### 3. Feed Composition
- ✅ Verify feed starts with blue cube
- ✅ Scroll to yellow pyramid (2nd item)
- ✅ Scroll to red sphere (3rd item)
- ✅ Scroll to first GLTF model (Suzanne - 4th item)
- ✅ Total feed should be 25 items

### 4. Hand Raycasts
- ✅ Pinch with left hand only → left ray visible
- ✅ Pinch with right hand only → right ray visible
- ✅ Pinch with both hands → both rays visible until two-hand mode detected
- ✅ Two-hand mode → both rays hidden
- ✅ Grab with left hand → left ray hidden, right ray can still show if pinching

### 5. Heart Gesture
- ✅ Bring hands together with index fingers touching at top
- ✅ Bring thumbs together at bottom to form heart shape
- ✅ Test with slightly misaligned hands (should still detect)
- ✅ Test with one pair very close (should detect with shape validation)
- ✅ Check debug logs for detection feedback

---

## Known Limitations

1. **Heart Gesture:** Requires both hands to be tracked by XR system. If one hand leaves tracking volume, gesture will fail.

2. **Two-Hand Transform:** Priority is given to transform (scale/rotate) over scroll. User must release and re-pinch to scroll after two-hand gestures.

3. **Model Auto-Scale:** Very small models (< 0.1mm) may not scale correctly due to minimum scale limits.

---

## Debug Commands

If issues persist, use these console commands for debugging:

```javascript
// Check tutorial state (should be inactive after tutorial)
feedControls.verifyFeaturesEnabled();

// Force reset scroll state
feedControls.resetScrollState();

// Check current feed index and item
console.log('Index:', store.index, 'Total:', store.items.length);
console.log('Current item:', store.items[store.index]);
```

---

## Changelog

**Date:** 2025-11-25  
**Version:** 1.2.0  
**Author:** AI Assistant

### Added
- Geometric shape-based heart gesture detection
- Comprehensive scroll state reset on two-hand mode transitions
- Equal raycast visibility for both hands

### Changed
- Model auto-scale target size: 0.5m → 0.4m
- Heart gesture thresholds: more strict for accuracy
- Feed composition: removed tutorial shapes

### Fixed
- Scroll triggering during rotation/scaling
- Left hand raycast visibility issues
- Heart gesture reliability
- Model scaling for better POV fit

---

## Migration Notes

**For users upgrading from v1.1.x:**

1. Feed will automatically reload with simplified shape set
2. Existing saved items and preferences are preserved
3. Tutorial will need to be re-completed if active
4. Heart gesture may feel different (more reliable but requires proper hand alignment)

---

## Support

For issues or questions:
1. Check debug logs in browser console (F12)
2. Verify XR hand tracking is working properly
3. Ensure both hands are visible to XR system
4. Try recalibrating hand tracking in device settings

---

*End of Document*

