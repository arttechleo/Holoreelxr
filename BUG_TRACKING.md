# 🐛 HoloreelXR - Bug Tracking & Fixes

## Critical Scroll Interaction Bugs

### BUG-001: Scroll Triggers Without Hand Movement
**Priority**: 🔴 CRITICAL  
**Status**: IDENTIFIED  
**Reported**: User feedback - scroll triggers when just holding pinch

**Root Cause**:
Multiple arming mechanisms bypass movement requirement:

1. **Distance-Based Auto-Arm** (Line 1143-1147)
   - Arms immediately if far from object (>3cm) or object bounds are null
   - **Problem**: No movement required
   - **Impact**: Pinch + hold = unwanted scroll

2. **Time-Based Auto-Arm** (Line 1160-1164)
   - Arms after 60ms without any movement check
   - **Problem**: Just waiting triggers scroll
   - **Impact**: Holding pinch for 60ms = unwanted scroll

3. **Emergency Auto-Arm** (Line 1167-1170)
   - Force-arms after 200ms if tutorial is completed
   - **Problem**: Nuclear option that ignores all conditions
   - **Impact**: Any pinch held >200ms = guaranteed unwanted scroll

**Expected Behavior**:
```
✅ Pinch + Hold (no movement) → NO scroll
✅ Pinch + Move up/down → YES scroll
```

**Current Behavior**:
```
❌ Pinch + Hold (no movement) → Scroll triggers after 60-200ms
❌ Pinch + Hold far from object → Immediate scroll
```

---

### BUG-002: Scroll Arming Logic Too Aggressive
**Priority**: 🟠 HIGH  
**Status**: IDENTIFIED  

**Issues**:
1. Distance threshold too low (3cm)
2. Movement threshold too sensitive (1mm)
3. Multiple fallback paths create unpredictable behavior
4. Null object bounds trigger immediate arm

**Impact**:
- User loses control over when scroll activates
- Accidental scrolling when trying to inspect object
- Difficult to grab objects without triggering scroll

---

### BUG-003: Scroll Accumulation Without Movement
**Priority**: 🟠 HIGH  
**Status**: IDENTIFIED  

**Root Cause** (Lines 1214-1225):
```typescript
const minVelocity = this.isTutorialCompleted() ? this.SCROLL_VEL_MIN * 0.5 : this.SCROLL_VEL_MIN;

if (Math.abs(dy) < minVelocity) {
  const minAccumThreshold = this.isTutorialCompleted() ? 0.0005 : 0.001;
  if (Math.abs(dy) > minAccumThreshold) {
    const accumFactor = this.isTutorialCompleted() ? 0.8 : 0.5;
    this.scrollAccum += dy * accumFactor; // ← Accumulates tiny jitter
  }
  return;
}
```

**Problem**:
- Accumulates hand tracking jitter/noise (0.5mm movements)
- After tutorial, threshold is very low (0.5mm)
- Over time, jitter accumulates to trigger scroll

**Impact**:
- Scroll triggers from noise, not intentional movement
- User sees feed change without moving hand

---

### BUG-004: Conflicting Scroll/Grab Priority Logic
**Priority**: 🟡 MEDIUM  
**Status**: IDENTIFIED  

**Root Cause**:
- Grab requires close proximity (<15cm)
- Scroll arms at >3cm distance
- Gap between 3-15cm creates confusion
- Both can be pending simultaneously

**Impact**:
- Unpredictable interaction when user is 5-10cm from object
- Scroll can cancel grab attempts
- Grab can block legitimate scroll

---

### BUG-005: Scroll Direction Not Clear
**Priority**: 🟡 MEDIUM  
**Status**: IDENTIFIED  

**Issues**:
1. No visual feedback when scroll is armed
2. Rubber band ray shows during scroll but may be confusing
3. User doesn't know if they're in "scroll mode" vs "grab mode"

**Impact**:
- User unsure what will happen when they move hand
- Trial and error required to learn interaction

---

## Proposed Fixes

### FIX-001: Movement-Only Scroll Arming ✅
**Approach**: Remove all auto-arm mechanisms, require actual movement

**Changes**:
```typescript
// ❌ REMOVE: Distance-based immediate arm
// ❌ REMOVE: Time-based auto-arm after 60ms
// ❌ REMOVE: Emergency auto-arm after 200ms

// ✅ KEEP: Movement-based arming ONLY
// Require 3-5mm of actual vertical movement to arm
```

**Benefits**:
- Predictable: scroll only when user moves hand
- No accidental scrolling from holding pinch
- Clear user intent required

---

### FIX-002: Stricter Movement Threshold ✅
**Approach**: Increase minimum movement to 3mm (from 1mm)

**Rationale**:
- 1mm is within hand tracking noise
- 3mm is clear intentional movement
- Reduces false positives from jitter

---

### FIX-003: Disable Jitter Accumulation ✅
**Approach**: Only accumulate movements above clear threshold

**Changes**:
```typescript
// Minimum movement to accumulate: 2mm (not 0.5mm)
// This filters out hand tracking noise
```

---

### FIX-004: Clear Scroll/Grab Distance Zones ✅
**Approach**: Define clear distance zones

**Zones**:
- **0-10cm**: Grab zone (scroll disabled)
- **>10cm**: Scroll zone (grab disabled)
- Clean separation, no overlap

---

### FIX-005: Better Visual Feedback ✅
**Approach**: Improve scroll ray visualization

**Changes**:
- Show ray immediately when pinching in scroll zone
- Different color when armed vs not armed
- Clear indication of scroll vs grab mode

---

## Testing Plan

### Test Case 1: Hold Pinch (No Movement)
**Steps**:
1. Pinch with one hand
2. Hold completely still for 5 seconds
3. Release pinch

**Expected**: ✅ No scroll, no feed change  
**Current**: ❌ Scrolls after 60-200ms

---

### Test Case 2: Pinch + Small Movement (1-2mm)
**Steps**:
1. Pinch with one hand
2. Move hand up/down 1-2mm (barely noticeable)
3. Hold still

**Expected**: ✅ No scroll (movement too small)  
**Current**: ❌ May scroll due to low threshold

---

### Test Case 3: Pinch + Clear Movement (5mm+)
**Steps**:
1. Pinch with one hand (far from object)
2. Move hand up 5mm
3. Continue moving up to 10mm total

**Expected**: ✅ Scroll to next item  
**Current**: ❌ May scroll too early or from distance alone

---

### Test Case 4: Pinch Near Object
**Steps**:
1. Move hand close to object (5cm)
2. Pinch and hold still
3. Try to move hand to grab

**Expected**: ✅ Grab activates, not scroll  
**Current**: ❌ May conflict or scroll instead

---

### Test Case 5: Pinch Far From Object
**Steps**:
1. Move hand far from object (30cm)
2. Pinch and hold still for 1 second
3. Then move hand up/down

**Expected**: ✅ No scroll until movement, then scroll  
**Current**: ❌ Scrolls immediately on pinch

---

## Implementation Checklist

- [x] Remove distance-based immediate arm (BUG-001, cause 1) ✅
- [x] Remove time-based auto-arm (BUG-001, cause 2) ✅
- [x] Remove emergency auto-arm (BUG-001, cause 3) ✅
- [x] Increase movement threshold to 3mm (FIX-002) ✅
- [x] Disable jitter accumulation <2mm (FIX-003) ✅
- [x] Define clear grab/scroll distance zones (FIX-004) ✅
  - 0-10cm = GRAB ZONE (grab priority)
  - >10cm = SCROLL ZONE (scroll priority)
- [x] Improve scroll ray visualization (FIX-005) ✅
  - Gray = Ready (not armed)
  - Green = Armed (will scroll)
  - Yellow = Scrolling (accumulating)
- [x] Add debug logging for scroll arming triggers ✅
- [ ] Test all 5 test cases (IN PROGRESS)
- [ ] Update documentation

---

## Root Cause Summary

**The core problem**: Over-optimization for "easy scrolling" created too many automatic pathways that bypass the fundamental requirement: **user must move hand to scroll**.

**The solution**: Simplify to single path:
1. User pinches
2. User moves hand vertically (3mm minimum)
3. Scroll arms
4. Accumulate movement
5. Trigger scroll at threshold (8mm)

**Philosophy**: User intent must be clear through action (movement), not inferred through time or distance.

---

## Metrics

**Before Fixes**:
- Time to unwanted scroll: 60-200ms of holding pinch
- False positive rate: HIGH (3+ ways to trigger without movement)
- User control: LOW (automatic behaviors)

**After Fixes** (Target):
- Time to unwanted scroll: NEVER (requires movement)
- False positive rate: NONE (movement required)
- User control: HIGH (predictable, intentional)

---

## Notes

- Previous fix attempt (d282ca3) over-corrected by making scroll TOO easy
- This created worse UX than original problem
- New approach: strict movement requirement, no shortcuts
- Better to have slightly harder scroll than accidental scrolling

