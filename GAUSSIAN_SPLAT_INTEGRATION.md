# Gaussian Splat Integration Guide

## Overview

This document describes how Gaussian Splatting is integrated into the Holoreelxr WebXR application. Gaussian Splats are a cutting-edge 3D representation format that provides high-quality, real-time rendering of 3D scenes using point-based rendering techniques.

## Architecture

### Library Choice

The project uses **@sparkjsdev/spark** (SparkJS) for Gaussian Splat rendering:

- **Version**: v0.1.10 (as of package.json)
- **Why SparkJS**: 
  - Modern, actively maintained library
  - Native Three.js integration (no iframes)
  - WebXR compatible
  - Supports .ply files and other formats (.spz, .splat, .ksplat)
  - Efficient rendering on low-powered devices
  - MIT license

### Core Components

1. **SparkRenderer** (`src/app/ThreeXRApp.ts`)
   - Initialized once at app startup
   - Added to the main Three.js scene
   - Updated every frame with camera information for proper XR support
   - Handles the actual rendering of all Gaussian Splat objects

2. **GaussianSplatLoader** (`src/feed/loaders/GaussianSplatLoader.ts`)
   - Loads .ply files using SparkJS SplatMesh API
   - Handles caching and normalization
   - Returns Three.js Group objects that can be added to the scene

3. **FeedStore** (`src/feed/FeedStore.ts`)
   - Integrates Gaussian Splats as a feed content type (`gaussianSplat`)
   - Handles loading, positioning, scaling, and cleanup
   - Manages lifecycle similar to GLTF models

## Integration Details

### Render Loop Integration

The key fix for WebXR compatibility is in `ThreeXRApp.start()`:

```typescript
// Update SparkRenderer with camera information
if (this.sparkRenderer && this.sparkRenderer.update) {
  this.sparkRenderer.update({ 
    scene: this.scene,
    camera: this.camera  // Critical for XR mode
  });
}

// Render the scene (Three.js handles XR camera updates automatically)
this.renderer.render(this.scene, this.camera);
```

**Important**: The camera passed to `sparkRenderer.update()` is automatically updated by Three.js when in XR mode. This ensures Gaussian Splats render correctly in both desktop and XR modes.

### Content Type

Gaussian Splats are defined in `feed.json` with the type `gaussianSplat`:

```json
{
  "id": "test-gaussian-splat",
  "title": "Test Gaussian Splat",
  "author": "HoloreelXR",
  "type": "gaussianSplat",
  "src": "/assets/aigengsplat.ply"
}
```

### Loading Process

1. **FeedStore** detects `type: 'gaussianSplat'` in feed items
2. **GaussianSplatLoader** loads the .ply file using SparkJS
3. SplatMesh is wrapped in a Three.js Group for consistency
4. Asset is normalized (scaled and centered) similar to GLTF models
5. Group is added to `contentRoot` in the scene
6. SparkRenderer automatically renders all SplatMesh objects in the scene

## Adding New Gaussian Splat Assets

### Step 1: Add Asset File

Place your .ply file in `public/assets/` directory:

```
public/
  assets/
    your-splat.ply
```

**Note**: Large files (>100MB) should be stored in Git LFS.

### Step 2: Add to Feed

Add an entry to `public/feed.json`:

```json
{
  "id": "unique-id",
  "title": "Your Splat Title",
  "author": "Creator Name",
  "type": "gaussianSplat",
  "src": "/assets/your-splat.ply"
}
```

### Step 3: Test

1. Start the dev server: `npm run dev`
2. Navigate to the feed item in desktop mode
3. Verify the splat loads and renders correctly
4. Enter XR mode (AR/VR) and verify it follows the camera correctly

## Known Limitations

1. **Performance**: Large Gaussian Splat files (>100MB) may take time to load and can impact performance on lower-end devices
2. **Memory**: Each splat consumes GPU memory. Multiple large splats may cause issues on mobile devices
3. **Format Support**: Currently supports .ply files. Other formats (.spz, .splat, .ksplat) may work but are not fully tested
4. **Cloning**: SplatMesh objects are shared between instances for efficiency. True cloning would require re-loading the file

## Troubleshooting

### Splat Not Rendering in Desktop Mode

1. Check browser console for errors
2. Verify the .ply file exists and is accessible
3. Check that `@sparkjsdev/spark` is installed: `npm install @sparkjsdev/spark`
4. Verify SparkRenderer initialized: Look for `[ThreeXRApp] SparkRenderer initialized successfully` in console

### Splat Not Rendering in XR Mode

1. Verify camera is being passed to SparkRenderer.update() (check render loop)
2. Check that `renderer.xr.enabled = true` in ThreeXRApp
3. Verify the splat object is visible: `splatAsset.scene.visible === true`
4. Check that the splat is added to the scene: `splatAsset.scene.parent !== null`

### Performance Issues

1. Reduce splat file size if possible
2. Check GPU memory usage in browser dev tools
3. Consider using lower-quality splat files for mobile devices
4. Ensure only one splat is loaded at a time (previous splats should be disposed)

### Common Errors

- **"Gaussian Splat library not available"**: Run `npm install @sparkjsdev/spark`
- **"CORS/Network issue"**: Ensure the .ply file is served from the same origin or CORS is enabled
- **"404 Not Found"**: Check that the file path in feed.json matches the actual file location
- **"Load timeout"**: File may be too large or network too slow. Consider using a CDN or optimizing the file

## Technical Details

### Normalization

Gaussian Splats are automatically normalized when loaded:
- Bounding box is calculated
- Scale is adjusted to fit a 1-unit bounding box
- Model is centered at origin
- This ensures consistent sizing across different splat files

### Auto-Scaling

Similar to GLTF models, Gaussian Splats are auto-scaled to fit the viewport:
- Bounding box is calculated
- Scale is adjusted to fit within a reasonable viewport size
- User can still manually scale using gestures/keyboard

### Cleanup

When navigating away from a Gaussian Splat:
1. The Group containing the SplatMesh is removed from the scene
2. Resources are cleaned up by SparkRenderer automatically
3. Cached assets remain in memory for faster re-loading

## Future Improvements

- [ ] Support for animated splat sequences
- [ ] Better error recovery and fallback rendering
- [ ] Performance optimizations for mobile devices
- [ ] Support for additional splat formats (.spz, .splat, .ksplat)
- [ ] True cloning support for multiple instances
- [ ] LOD (Level of Detail) support for distant splats

## References

- SparkJS Documentation: https://sparkjs.dev
- Three.js WebXR Guide: https://threejs.org/docs/#manual/en/introduction/How-to-use-WebXR
- Gaussian Splatting Paper: https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/

