# Adding Assets to HoloreelXR

This guide explains how to manually add 3D model links to your HoloreelXR project.

## Feed File Location

All feed items are stored in `public/feed.json`. This file contains an array of items that will be displayed in the feed.

## Feed Item Types

### 1. Shape Items (Built-in Geometric Shapes)

Simple geometric shapes for tutorials and testing:

```json
{
  "id": "unique-id",
  "title": "Display Name",
  "author": "Author Name",
  "type": "shape",
  "shape": "sphere" | "box" | "pyramid",
  "color": "#FF6B6B"
}
```

**Example:**
```json
{
  "id": "tutorial-sphere",
  "title": "Welcome",
  "author": "HoloreelXR",
  "type": "shape",
  "shape": "sphere",
  "color": "#FF6B6B"
}
```

### 2. GLTF/GLB Models (3D Models)

Load 3D models from URLs (Sketchfab, Animated.xyz, Stale.art, or any direct link):

```json
{
  "id": "unique-id",
  "title": "Model Name",
  "author": "Creator Name",
  "type": "gltf" | "glb",
  "src": "https://example.com/model.glb"
}
```

**Example:**
```json
{
  "id": "glb-1",
  "title": "Animated Robot",
  "author": "Sketchfab",
  "type": "glb",
  "src": "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/AnimatedMorphSphere/glTF-Binary/AnimatedMorphSphere.glb"
}
```

### 3. PLY Models (Point Clouds)

Load PLY point cloud files:

```json
{
  "id": "unique-id",
  "title": "Point Cloud Name",
  "author": "Creator Name",
  "type": "ply",
  "src": "https://example.com/model.ply"
}
```

### 4. Splat4D Sequences (Animated Point Clouds)

Load animated sequences of PLY files:

```json
{
  "id": "unique-id",
  "title": "Animation Name",
  "author": "Creator Name",
  "type": "splat4d",
  "fps": 30,
  "frames": [
    "https://example.com/frame1.ply",
    "https://example.com/frame2.ply",
    "https://example.com/frame3.ply"
  ]
}
```

## How to Add Links

### Step 1: Open `public/feed.json`

Edit the file `public/feed.json` in your project root.

### Step 2: Add Your Item

Add a new object to the array. Make sure:
- Each item has a unique `id`
- The `src` URL is publicly accessible (CORS-enabled)
- The file format matches the `type` field

### Step 3: Save and Reload

Save the file and reload your application. The new item will appear in the feed.

## Example: Complete Feed File

```json
[
  {
    "id": "tutorial-sphere",
    "title": "Welcome",
    "author": "HoloreelXR",
    "type": "shape",
    "shape": "sphere",
    "color": "#FF6B6B"
  },
  {
    "id": "tutorial-box",
    "title": "Pinch Tutorial",
    "author": "HoloreelXR",
    "type": "shape",
    "shape": "box",
    "color": "#4ECDC4"
  },
  {
    "id": "tutorial-pyramid",
    "title": "Scroll Tutorial",
    "author": "HoloreelXR",
    "type": "shape",
    "shape": "pyramid",
    "color": "#95E1D3"
  },
  {
    "id": "my-custom-model",
    "title": "My 3D Model",
    "author": "My Name",
    "type": "glb",
    "src": "https://example.com/my-model.glb"
  }
]
```

## Supported 3D Model Sources

### Sketchfab
- Get the model URL from Sketchfab
- Use the direct download link (may require API access)
- Format: `https://sketchfab.com/models/{model-id}/download`

### Animated.xyz
- Copy the direct GLB/GLTF link
- Format: `https://animated.xyz/path/to/model.glb`

### Stale.art
- Copy the direct GLB/GLTF link
- Format: `https://stale.art/path/to/model.glb`

### Direct Links
- Any publicly accessible `.glb` or `.gltf` file
- Must have CORS headers enabled
- Format: `https://your-domain.com/models/model.glb`

## Tips

1. **Test URLs First**: Make sure your URLs are accessible and the files load correctly
2. **Use HTTPS**: Always use HTTPS URLs for security
3. **Check CORS**: External URLs must have proper CORS headers
4. **File Size**: Large models may take time to load
5. **Unique IDs**: Each item must have a unique `id` field

## Troubleshooting

- **Model doesn't load**: Check browser console for CORS or 404 errors
- **Model appears too large/small**: Models are auto-scaled to fit
- **Animation not playing**: Ensure GLTF animations are included in the file
- **Feed not updating**: Clear browser cache and reload

