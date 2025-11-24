# 🧪 Scroll Interaction Testing Guide

## Testing Environment
- **Device**: Meta Quest 2/3/Pro, Quest 3S, or any WebXR-compatible headset
- **Browser**: Meta Quest Browser or compatible WebXR browser
- **App**: HoloreelXR in Mixed Reality mode

## Pre-Test Setup
1. Enter XR/MR mode
2. Complete the onboarding tutorial (all 8 steps)
3. You should see the Earth sphere (blue sphere with Earth texture)
4. Position yourself comfortably with space to move hands

---

## Test Case 1: Hold Pinch (No Movement)
**Purpose**: Verify scroll does NOT trigger without hand movement

**Steps**:
1. Pinch with one hand far from object (>10cm)
2. Hold pinch completely still for 5 seconds
3. Watch for any feed changes
4. Release pinch

**Expected Result**: ✅
- No scroll occurs
- Feed stays on Earth sphere
- Gray ray may be visible (ready state)
- No unwanted feed navigation

**Failure Indicators**: ❌
- Feed scrolls to next item
- Console shows "TRIGGERING SCROLL"
- Yellow ray appears without movement

**Debug Logs**:
```
[Scroll] Scroll zone (...cm) - ready to scroll on movement
(No arming or trigger logs should appear)
```

---

## Test Case 2: Pinch + Small Jitter (1-2mm)
**Purpose**: Verify hand tracking noise doesn't trigger scroll

**Steps**:
1. Pinch with one hand far from object (>10cm)
2. Try to hold still but allow natural hand shake (1-2mm)
3. Hold for 3 seconds
4. Release pinch

**Expected Result**: ✅
- No scroll occurs
- Small movements are ignored as noise
- Gray ray visible but doesn't turn green
- Feed stays on Earth sphere

**Failure Indicators**: ❌
- Scroll triggers from tiny movements
- Console shows accumulation from sub-2mm movements

**Debug Logs**:
```
[Scroll] Scroll zone (...cm) - ready to scroll on movement
(Movement too small to arm - no arming message)
```

---

## Test Case 3: Pinch + Clear Vertical Movement (5mm+)
**Purpose**: Verify intentional scroll works correctly

**Steps**:
1. Pinch with one hand far from object (>10cm)
2. Hold for ~100ms (let tracking stabilize)
3. Move hand UP clearly (5-10mm total)
4. Continue moving smoothly
5. Observe feed change

**Expected Result**: ✅
- After 3mm vertical movement: scroll arms (ray turns GREEN)
- Ray turns YELLOW as movement accumulates
- After 8mm accumulated movement: scroll triggers
- Feed advances to next item (magenta test cube)
- Console logs show clear progression

**Failure Indicators**: ❌
- Scroll doesn't trigger despite clear movement
- Requires excessive movement (>15mm)
- Scroll triggers before arming

**Debug Logs**:
```
[Scroll] Scroll zone (35.2cm) - ready to scroll on movement
[Scroll] ✅ Armed by movement: 0.32cm vertical movement detected
[Scroll] Accumulating: dy=0.0025m, total=0.0060m, threshold=0.008m
[Scroll] ✅✅✅ TRIGGERING SCROLL! Direction: Next, Accum: 0.0085m
[FeedStore] ✅ Scrolling: index 8 → 9, item: Test Cube (Post-Tutorial)
```

---

## Test Case 4: Pinch Near Object (<10cm)
**Purpose**: Verify grab has priority in grab zone

**Steps**:
1. Move hand close to Earth sphere (5-10cm)
2. Pinch and hold still briefly
3. Try to move hand to reposition object
4. Observe whether grab or scroll activates

**Expected Result**: ✅
- Grab pending or instant grab activates
- Scroll is disabled (no gray ray)
- Hand can move object
- Console shows "Grab zone" messages

**Failure Indicators**: ❌
- Scroll activates despite being close to object
- Cannot grab object
- Conflicting grab/scroll states

**Debug Logs**:
```
[Grab] Grab zone (7.5cm) - pending grab
OR
[Grab] ✅ Instant grab! Distance: 4.2cm
```

---

## Test Case 5: Pinch Very Far From Object (>30cm)
**Purpose**: Verify scroll works at long distance

**Steps**:
1. Move hand far from object (30cm+)
2. Pinch with one hand
3. Move hand up/down clearly (5mm+)
4. Observe scroll behavior

**Expected Result**: ✅
- Same behavior as Test Case 3
- Distance doesn't affect scroll
- Movement requirement is the same
- Scroll triggers after 8mm accumulated movement

**Failure Indicators**: ❌
- Scroll behaves differently at different distances
- Requires more or less movement than normal

**Debug Logs**:
```
[Scroll] Scroll zone (42.8cm) - ready to scroll on movement
[Scroll] ✅ Armed by movement: 0.35cm vertical movement detected
[Scroll] ✅✅✅ TRIGGERING SCROLL! Direction: Next, Accum: 0.0092m
```

---

## Test Case 6: Scroll Direction (Up vs Down)
**Purpose**: Verify scroll direction matches hand movement

**Steps**:
1. Start on magenta test cube (after previous tests)
2. Pinch far from object
3. Move hand DOWN clearly (5-10mm)
4. Observe direction

**Expected Result**: ✅
- Hand DOWN = scroll BACK to Earth sphere
- Console shows "Direction: Previous"
- Feed goes back one item

**Then test opposite**:
5. Pinch again
6. Move hand UP clearly (5-10mm)
7. Observe direction

**Expected Result**: ✅
- Hand UP = scroll FORWARD to next item
- Console shows "Direction: Next"
- Feed advances

**Failure Indicators**: ❌
- Direction is inverted (up scrolls back)
- Direction is random
- Both directions scroll forward

**Debug Logs**:
```
[Scroll] ✅✅✅ TRIGGERING SCROLL! Direction: Previous, Accum: -0.0089m
OR
[Scroll] ✅✅✅ TRIGGERING SCROLL! Direction: Next, Accum: 0.0092m
```

---

## Test Case 7: Rapid Scroll Prevention (Cooldown)
**Purpose**: Verify scroll cooldown prevents spam

**Steps**:
1. Scroll to next item (hand up)
2. Immediately try to scroll again
3. Observe cooldown behavior

**Expected Result**: ✅
- First scroll works normally
- Second scroll attempt is blocked for ~120ms
- Console shows cooldown in effect
- Prevents accidental double-scroll

**Failure Indicators**: ❌
- Can scroll multiple times instantly
- Feed skips multiple items
- No cooldown protection

---

## Test Case 8: Switch Between Scroll and Grab
**Purpose**: Verify zones don't interfere

**Steps**:
1. Start far from object (scroll zone)
2. Pinch and scroll up (verify scroll works)
3. Release pinch
4. Move hand close to object (<10cm)
5. Pinch and try to grab
6. Verify grab works
7. Release grab
8. Move hand far again
9. Scroll again

**Expected Result**: ✅
- Each zone works independently
- No state pollution between zones
- Clear transitions
- No conflicts

---

## Visual Feedback Reference

### Scroll Ray Colors
- **Gray (0x888888)**: Ready to scroll - pinching in scroll zone, not armed yet
- **Green (0x88ff88)**: Armed - movement detected (≥3mm), will scroll on continued movement
- **Yellow (0xffff88)**: Scrolling - actively accumulating movement, about to trigger

### Ray Visibility
- **Visible**: Pinching in scroll zone (>10cm from object)
- **Hidden**: Pinching in grab zone (<10cm from object) OR not pinching

---

## Performance Metrics (Target)

| Metric | Target | Purpose |
|--------|--------|---------|
| False positive rate | 0% | No scroll without intentional movement |
| Arming threshold | 3mm | Clear intentional movement |
| Trigger threshold | 8mm | Comfortable scroll distance |
| Cooldown | 120ms | Prevent double-scroll |
| Grab zone | 0-10cm | Clear separation from scroll |
| Scroll zone | >10cm | Predictable interaction area |

---

## Common Issues & Solutions

### Issue: Scroll triggers without movement
**Check**:
- Console logs for auto-arm messages (should NOT appear)
- Ray color (should stay gray until you move)
- Build version (ensure latest fixes applied)

**Solution**: If this occurs, the auto-arm logic wasn't properly removed

---

### Issue: Scroll doesn't trigger despite movement
**Check**:
- Movement amount (needs ≥3mm to arm, ≥8mm to trigger)
- Hand distance from object (must be >10cm)
- Console logs for "Grab zone" messages

**Solution**:
- Move hand farther from object (>10cm)
- Use larger, clearer movements
- Wait ~50ms after pinch before moving

---

### Issue: Ray doesn't appear
**Check**:
- Distance from object (must be >10cm for scroll zone)
- Object loaded (ray needs valid object position)
- Tutorial completed (ray hidden during tutorial)

**Solution**: Move hand farther from object

---

### Issue: Can't grab object
**Check**:
- Distance from object (must be <10cm for grab zone)
- Console logs for zone messages

**Solution**: Move hand closer to object (<10cm)

---

## Success Criteria

**All tests pass if**:
- ✅ Test 1: No scroll when holding still
- ✅ Test 2: No scroll from hand tracking noise
- ✅ Test 3: Scroll works with clear movement
- ✅ Test 4: Grab works when close to object
- ✅ Test 5: Scroll works at long distance
- ✅ Test 6: Direction matches hand movement
- ✅ Test 7: Cooldown prevents spam
- ✅ Test 8: Zones don't interfere

**Critical failures** (must fix):
- ❌ Any scroll without hand movement (Test 1)
- ❌ Scroll from tiny jitter (Test 2)
- ❌ Wrong scroll direction (Test 6)

**Minor issues** (can iterate):
- ⚠️ Requires excessive movement (>15mm)
- ⚠️ Grab/scroll zone conflicts
- ⚠️ Poor visual feedback

---

## Reporting Issues

When reporting issues, include:
1. Test case number that failed
2. Console logs (full scroll section)
3. Hand distance from object (estimated in cm)
4. Movement amount (estimated in mm)
5. Expected vs actual behavior
6. Device/browser information

**Example Report**:
```
Test Case 1 FAILED
- Console: "[Scroll] ✅ Auto-armed after 150ms"
- Distance: ~25cm from object
- Movement: Holding completely still
- Expected: No scroll
- Actual: Scrolled to next item after 150ms
- Device: Quest 3, Meta Browser
```

---

## Next Steps After Testing

1. **If all tests pass**: Mark as production-ready ✅
2. **If critical failures**: Fix immediately, retest
3. **If minor issues**: Document for future iteration
4. **User feedback**: Gather from real users in XR
5. **Iterate**: Adjust thresholds based on feedback

