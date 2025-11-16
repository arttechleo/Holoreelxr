# Performance Optimization Guide

This document outlines performance best practices and optimization strategies for Holoreelxr.

## Performance Targets

- **VR Refresh Rate**: 90 FPS (11ms frame budget) on Quest 2
- **AR Refresh Rate**: 60 FPS (16ms frame budget) minimum
- **Memory**: < 500MB for smooth operation
- **Load Time**: < 3 seconds for initial content

## Critical Performance Areas

### 1. Geometry & Materials

#### ✅ Best Practices
```typescript
// Reuse geometries and materials
const sharedGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const sharedMaterial = new THREE.MeshStandardMaterial({ color: 0x66ccff });

// Create multiple meshes without duplicating geometry
const mesh1 = new THREE.Mesh(sharedGeometry, sharedMaterial);
const mesh2 = new THREE.Mesh(sharedGeometry, sharedMaterial);
```

#### ❌ Anti-patterns
```typescript
// DON'T create new geometry for each object
for (let i = 0; i < 100; i++) {
  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4); // Memory leak!
  const mesh = new THREE.Mesh(geo, material);
}
```

#### Disposal
Always dispose of resources when done:
```typescript
// Proper cleanup
mesh.geometry.dispose();
if (Array.isArray(mesh.material)) {
  mesh.material.forEach(m => m.dispose());
} else {
  mesh.material.dispose();
}
```

### 2. Point Cloud Rendering

PLY files can be heavy. Optimize with:

#### Level of Detail (LOD)
```typescript
// Reduce point count based on distance
const distanceToCamera = pointCloud.position.distanceTo(camera.position);
if (distanceToCamera > 3.0) {
  material.size = 0.005; // Smaller points
} else {
  material.size = 0.01;  // Normal size
}
```

#### Point Culling
```typescript
// Enable frustum culling
pointCloud.frustumCulled = true;

// For large point clouds, consider octree-based culling
```

### 3. Hand Tracking Performance

Hand tracking runs every frame - optimize carefully:

#### Minimize Allocations
```typescript
// ❌ BAD: Creates new Vector3 every frame
function getJointPos(joint: string) {
  return new THREE.Vector3(x, y, z); // Allocation!
}

// ✅ GOOD: Reuse existing Vector3
const tempVec = new THREE.Vector3();
function getJointPos(joint: string, target: THREE.Vector3) {
  return target.set(x, y, z); // No allocation
}
```

#### Debounce Expensive Calculations
```typescript
// Don't check expensive gestures every frame
let lastGestureCheck = 0;
const GESTURE_CHECK_INTERVAL = 50; // ms

if (now - lastGestureCheck > GESTURE_CHECK_INTERVAL) {
  checkComplexGestures();
  lastGestureCheck = now;
}
```

### 4. UI Rendering

Canvas-based textures can be expensive:

#### Minimize Redraws
```typescript
// Only redraw when content changes
let needsRedraw = false;

function updateCount(count: number) {
  this.count = count;
  needsRedraw = true; // Flag for redraw
}

function tick() {
  if (needsRedraw) {
    redrawCanvas();
    texture.needsUpdate = true;
    needsRedraw = false;
  }
}
```

#### Use Appropriate Resolution
```typescript
// Don't use 4K canvas for a 0.5m panel
const CANVAS_WIDTH = 1152;  // Good
// const CANVAS_WIDTH = 3840; // Overkill for VR
```

### 5. Animation & Updates

#### Use Object Pooling
```typescript
// Particle pool to avoid allocations
class ParticlePool {
  private pool: Particle[] = [];
  
  acquire(): Particle {
    return this.pool.pop() || new Particle();
  }
  
  release(particle: Particle): void {
    particle.reset();
    this.pool.push(particle);
  }
}
```

#### Batch Updates
```typescript
// Update all particles in one pass
function updateParticles(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(dt);
    if (particles[i].isDead) {
      particles[i].dispose();
      particles.splice(i, 1);
    }
  }
}
```

### 6. Network & Loading

#### Lazy Load Content
```typescript
// Load content on-demand, not all at once
async function showItem(index: number) {
  const item = feed[index];
  
  // Only load when needed
  if (!loadedItems.has(item.id)) {
    await loadContent(item);
    loadedItems.set(item.id, content);
  }
}
```

#### Progressive Loading
```typescript
// Load low-res first, then high-res
async function loadPLY(url: string) {
  const lowRes = await loadPLY(`${url}?quality=low`);
  scene.add(lowRes);
  
  // Background load high-res
  loadPLY(`${url}?quality=high`).then(highRes => {
    scene.remove(lowRes);
    scene.add(highRes);
    lowRes.dispose();
  });
}
```

## Profiling Tools

### Chrome DevTools
1. Open DevTools (F12)
2. Performance tab
3. Record while in VR
4. Look for:
   - Long frames (> 11ms)
   - Excessive garbage collection
   - Memory leaks

### Three.js Stats
```typescript
import Stats from 'three/examples/jsm/libs/stats.module.js';

const stats = new Stats();
document.body.appendChild(stats.dom);

// In render loop
stats.begin();
renderer.render(scene, camera);
stats.end();
```

### WebXR Performance Monitor
```typescript
function onXRFrame(time: number, frame: XRFrame) {
  const start = performance.now();
  
  // Your frame logic
  updateScene();
  renderer.render(scene, camera);
  
  const frameTime = performance.now() - start;
  if (frameTime > 11) {
    console.warn(`Slow frame: ${frameTime.toFixed(2)}ms`);
  }
}
```

## Common Performance Issues

### Issue: Frame drops when scrolling
**Cause**: Loading new content synchronously  
**Solution**: Preload adjacent items
```typescript
async function preloadAdjacentItems(currentIndex: number) {
  const prev = feed[currentIndex - 1];
  const next = feed[currentIndex + 1];
  
  if (prev && !loadedItems.has(prev.id)) {
    loadContent(prev); // Fire and forget
  }
  if (next && !loadedItems.has(next.id)) {
    loadContent(next);
  }
}
```

### Issue: Memory keeps growing
**Cause**: Not disposing old content  
**Solution**: Explicit cleanup
```typescript
function clearOldContent() {
  scene.children.slice().forEach(child => {
    if (child.name === 'old-content') {
      scene.remove(child);
      child.traverse((node: any) => {
        node.geometry?.dispose();
        node.material?.dispose();
      });
    }
  });
}
```

### Issue: Gestures feel laggy
**Cause**: Too much smoothing  
**Solution**: Reduce filter window
```typescript
// Was: 10 frames of smoothing (too much)
const SMOOTH_FRAMES = 4; // Better

// Was: 200ms settle time (too slow)
const SETTLE_TIME_MS = 100; // Snappier
```

## Mobile VR Optimizations (Quest)

### Reduce Draw Calls
```typescript
// Merge static geometry
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const geometries = [geo1, geo2, geo3];
const merged = BufferGeometryUtils.mergeGeometries(geometries);
const mesh = new THREE.Mesh(merged, material);
```

### Lower Texture Resolution
```typescript
// Use compressed textures for Quest
const texture = new THREE.CompressedTexture(...);

// Or reduce size
const canvas = document.createElement('canvas');
canvas.width = 512;  // Instead of 1024
canvas.height = 512;
```

### Disable Expensive Features
```typescript
// Disable shadows on mobile
renderer.shadowMap.enabled = false;

// Use simpler materials
const material = new THREE.MeshBasicMaterial({
  map: texture,
  // No PBR properties needed
});
```

## Monitoring in Production

```typescript
// Track key metrics
class PerformanceMonitor {
  private frameTimes: number[] = [];
  
  recordFrame(frameTime: number) {
    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > 300) { // 5 sec at 60fps
      this.frameTimes.shift();
    }
  }
  
  getStats() {
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const max = Math.max(...this.frameTimes);
    const droppedFrames = this.frameTimes.filter(t => t > 16).length;
    
    return { avg, max, droppedFrames };
  }
}
```

## Checklist

Before deploying:
- [ ] All geometries/materials are disposed on cleanup
- [ ] No allocations in hot paths (per-frame functions)
- [ ] Textures are reasonably sized (< 2K for most UI)
- [ ] Point clouds use appropriate point size/count
- [ ] Content is lazy-loaded, not all upfront
- [ ] Frame time consistently < 11ms on target hardware
- [ ] Memory usage stable over 5+ minutes
- [ ] No console warnings about dropped frames

## Resources

- [Three.js Performance Tips](https://threejs.org/docs/#manual/en/introduction/Performance-tips)
- [WebXR Best Practices](https://immersiveweb.dev/webxr-samples/)
- [Meta Quest Performance Guidelines](https://developer.oculus.com/documentation/web/web-performance/)

