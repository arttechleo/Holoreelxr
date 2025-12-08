# Gaussian Splat Integration Guide

## Overview

This document describes the Gaussian Splatting integration in Holoreelxr, including both Spark and GaussianSplats3D backends, debugging tools, and performance considerations.

## Architecture

### Backend Abstraction

The app uses a backend abstraction layer (`GaussianSplatBackend`) that allows switching between different Gaussian Splat libraries:

- **Spark** (`@sparkjsdev/spark`) - Default backend, integrated with SparkRenderer
- **GaussianSplats3D** (`@mkkellogg/gaussian-splats-3d`) - Alternative backend with proven WebXR support

### Current Implementation

1. **ThreeXRApp.ts**: 
   - Initializes `SparkRenderer` with `autoUpdate: true`
   - Updates SparkRenderer every frame with correct camera (XR or desktop)
   - Render order: `sparkRenderer.update()` → `renderer.render()`

2. **GaussianSplatLoader.ts**: 
   - Loads PLY files using Spark's `SplatMesh` class
   - Wraps SplatMesh in a `THREE.Group` for consistency
   - Normalizes scale and position

3. **FeedStore.ts**: 
   - Uses backend abstraction to load splats
   - Adds splat groups to `contentRoot` in the scene

## Configuration

### Backend Selection

Set the backend via environment variable or config:

```typescript
// In src/config/constants.ts
export const GAUSSIAN_SPLAT = {
  BACKEND: 'spark' | 'gaussian-splats-3d', // Default: 'spark'
  QUALITY: 'high' | 'medium' | 'low',      // Default: 'medium'
  DEBUG_OVERLAY: true | false,             // Default: false
  TARGET_FPS: 72,                          // Quest 3 target
}
```

Or via environment variable:
```bash
VITE_GAUSSIAN_BACKEND=spark npm run dev
VITE_GAUSSIAN_BACKEND=gaussian-splats-3d npm run dev
```

### Debug Overlay

Enable debug overlay to see real-time diagnostics:

```bash
VITE_GAUSSIAN_DEBUG=true npm run dev
```

The overlay shows:
- Current backend (Spark or GaussianSplats3D)
- SplatMesh count in scene
- SparkRenderer status
- XR mode (Desktop or XR)
- Camera type

## Adding Gaussian Splats

1. Place PLY files in `public/assets/` directory
2. Reference in `feed.json`:
   ```json
   {
     "id": "splat-1",
     "title": "My Splat",
     "author": "Author",
     "type": "gaussianSplat",
     "src": "/assets/mysplat.ply"
   }
   ```

## Troubleshooting

### Splats Not Visible (Axes Show But No Splat)

**Symptoms:**
- AxesHelper is visible
- Console shows successful loading
- SplatMesh count > 0
- But splat itself is not visible

**Debugging Steps:**

1. **Check SparkRenderer Status:**
   ```javascript
   // In browser console
   window.app.sparkRenderer // Should be defined
   window.app.countSplatMeshesInScene() // Should return count > 0
   ```

2. **Verify Render Loop:**
   - Check console for `[SparkDebug]` logs
   - Ensure `sparkRenderer.update()` is being called every frame
   - Verify camera is passed correctly (especially in XR mode)

3. **Check SplatMesh Discovery:**
   - SplatMesh should be in scene graph (even if wrapped in Group)
   - SparkRenderer should traverse scene and find SplatMesh
   - Verify `visible` flags are true

4. **Try Alternative Backend:**
   ```bash
   VITE_GAUSSIAN_BACKEND=gaussian-splats-3d npm run dev
   ```

### Performance Issues

**On Quest 3:**
- Target: 72 FPS for static splats
- Large splats (>100MB) may cause frame drops
- Consider using quality presets if available
- Monitor FPS in debug overlay

**Optimization Tips:**
- Use compressed formats (`.ksplat` instead of `.ply`) if supported
- Reduce splat count for large scenes
- Enable LOD if backend supports it

## Known Issues & Limitations

### Spark Backend

- **Issue**: Splats may not render if SparkRenderer doesn't discover SplatMesh
- **Workaround**: Ensure SplatMesh is in scene graph, check `visible` flags
- **Status**: Under investigation - may require SparkRenderer API changes

### GaussianSplats3D Backend

- **Status**: Implemented but not fully tested
- **API**: May require adjustment based on actual library exports
- **WebXR**: Should work automatically (standard Three.js objects)

## Files Changed

### Core Integration
- `src/app/ThreeXRApp.ts` - SparkRenderer initialization and render loop
- `src/feed/FeedStore.ts` - Backend abstraction usage
- `src/feed/loaders/GaussianSplatLoader.ts` - Spark-based loader
- `src/feed/loaders/GaussianSplatBackend.ts` - Backend abstraction layer

### Configuration
- `src/config/constants.ts` - Added `GAUSSIAN_SPLAT` config section

## Testing

### Desktop Mode
1. Load feed with Gaussian splat item
2. Verify splat is visible (not just axes)
3. Check console for errors
4. Verify debug overlay (if enabled)

### WebXR Mode (Quest 3)
1. Start XR session
2. Load Gaussian splat feed item
3. Verify splat is visible and stable in 3D space
4. Move head - splat should remain fixed in world space
5. Check FPS (target: 72 FPS)

## Next Steps

1. **Fix Spark Discovery**: If SparkRenderer still doesn't discover SplatMesh, investigate:
   - Direct scene addition (not wrapped in Group)
   - SparkRenderer API for explicit registration
   - Scene traversal order

2. **Test GaussianSplats3D**: Fully test alternative backend on Quest 3

3. **Performance Tuning**: Add quality presets and LOD support

4. **4D/Animated Splats**: Extend architecture for animated splat sequences

## References

- SparkJS: https://sparkjs.dev
- GaussianSplats3D: https://github.com/mkkellogg/GaussianSplats3D
- Three.js WebXR: https://threejs.org/docs/#manual/en/introduction/How-to-use-WebXR
