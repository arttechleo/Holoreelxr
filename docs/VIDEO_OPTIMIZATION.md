# Tutorial Video Optimization Guide

This guide explains how to optimize gesture tutorial videos for WebXR performance.

## Quick Start

1. **Install ffmpeg** (if not already installed):
   - Mac: `brew install ffmpeg`
   - Linux: `apt-get install ffmpeg` or `yum install ffmpeg`
   - Windows: Download from https://ffmpeg.org/download.html

2. **Run the optimization script**:
   ```bash
   npm run optimize:videos
   ```
   
   Or use the shell script directly:
   ```bash
   ./scripts/optimize-tutorial-videos.sh
   ```

3. **Review optimized videos** in `public/gestuivideo/optimized/`

4. **Update TutorialSteps.ts** to use optimized videos (optional - see below)

## Optimization Settings

The optimization script uses the following settings for WebXR:

- **Resolution**: 480p (854x480, scales to fit 16:9)
- **Framerate**: 30 fps
- **Codec**: H.264 (AVC) with Main profile
- **Bitrate**: 1 Mbps (max 1.2 Mbps, buffer 2 Mbps)
- **Preset**: `veryfast` (good compression, fast encoding)
- **Tuning**: `zerolatency` (optimized for instant playback)
- **GOP**: 60 frames (2 seconds at 30fps)
- **Faststart**: Enabled (moov atom at front for instant playback)
- **Audio**: Removed (smaller files, not needed for gesture demos)

## File Size Expectations

Typical results:
- **Original**: 2-5 MB per video
- **Optimized**: 200-500 KB per video
- **Reduction**: 80-90% smaller files

## Using Optimized Videos

### Option 1: Replace Original Files (Recommended)

After optimization, you can replace the original files:

```bash
# Backup originals
mv public/gestuivideo public/gestuivideo_original

# Use optimized versions
mv public/gestuivideo/optimized public/gestuivideo
```

### Option 2: Update TutorialSteps.ts

If you want to keep both versions, update `src/ui/tutorial/TutorialSteps.ts`:

```typescript
videoSrc: '/gestuivideo/optimized/Rotate.mp4',
```

## Performance Benefits

With optimized videos:

✅ **Faster loading**: 80-90% smaller files download much faster
✅ **Instant playback**: `faststart` flag allows playback to begin immediately
✅ **Hardware acceleration**: H.264 is hardware-decoded on Quest, Vision Pro, and most devices
✅ **Smooth playback**: 30fps is sufficient for gesture demos
✅ **Better caching**: Smaller files cache more efficiently

## VideoManager Features

The `VideoManager` class already implements best practices:

- ✅ Preloads all videos before they're needed
- ✅ Reuses HTMLVideoElement instances (no recreation per step)
- ✅ Reuses THREE.VideoTexture instances
- ✅ Waits for `canplaythrough` event before marking as ready
- ✅ Pauses all videos when tutorial is hidden
- ✅ Only plays videos when tutorial is visible

## Server Configuration

For production, ensure your server:

1. **Serves videos with proper cache headers**:
   ```
   Cache-Control: public, max-age=31536000, immutable
   ```

2. **Uses HTTP/2** (most modern servers do by default)

3. **Does NOT compress MP4 files** (they're already compressed)

## Troubleshooting

### ffmpeg not found
- Install ffmpeg using your system's package manager
- On Windows, add ffmpeg to your PATH

### Videos still loading slowly
- Check network tab in browser devtools
- Verify `faststart` flag is present: `ffprobe -v error -show_format video.mp4 | grep faststart`
- Ensure videos are being cached (check Cache-Control headers)

### Playback stuttering
- Verify videos are hardware-accelerated (check browser console)
- Reduce bitrate if needed (edit script: `-b:v 800k`)
- Check device performance (Quest 3 should handle 1Mbps easily)

## Manual Optimization

If you need to optimize a single video manually:

```bash
ffmpeg -i input.mp4 \
  -vf "scale=854:-2" \
  -r 30 \
  -c:v libx264 -preset veryfast -profile:v main -tune zerolatency \
  -b:v 1000k -maxrate 1200k -bufsize 2000k \
  -g 60 \
  -movflags +faststart \
  -an \
  output.mp4
```

## References

- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [WebXR Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)
- [Video Encoding for Web](https://web.dev/video/)

