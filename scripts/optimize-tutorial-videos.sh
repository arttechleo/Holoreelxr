#!/bin/bash
# Optimize tutorial gesture videos for WebXR
# Requirements: ffmpeg must be installed
# Usage: ./scripts/optimize-tutorial-videos.sh

set -e

INPUT_DIR="public/gestuivideo"
OUTPUT_DIR="public/gestuivideo/optimized"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "🎬 Optimizing tutorial videos for WebXR..."
echo "Input: $INPUT_DIR"
echo "Output: $OUTPUT_DIR"
echo ""

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ Error: ffmpeg is not installed"
    echo "Install it with: brew install ffmpeg (Mac) or apt-get install ffmpeg (Linux)"
    exit 1
fi

# Process each video
for video in "$INPUT_DIR"/*.mp4; do
    if [ -f "$video" ]; then
        filename=$(basename "$video")
        output_path="$OUTPUT_DIR/$filename"
        
        echo "Processing: $filename"
        
        # Optimize for WebXR:
        # - 480p resolution (854x480 for 16:9, scales to fit)
        # - 30fps
        # - H.264 with fast preset and zero latency tuning
        # - 1Mbps bitrate (small files, fast loading)
        # - faststart flag (moov atom at front for instant playback)
        # - Remove audio track (smaller files)
        ffmpeg -i "$video" \
            -vf "scale=854:-2" \
            -r 30 \
            -c:v libx264 \
            -preset veryfast \
            -profile:v main \
            -tune zerolatency \
            -b:v 1000k \
            -maxrate 1200k \
            -bufsize 2000k \
            -g 60 \
            -movflags +faststart \
            -an \
            -y \
            "$output_path" 2>&1 | grep -E "(Duration|Stream|Output|error)" || true
        
        # Get file sizes for comparison
        original_size=$(du -h "$video" | cut -f1)
        optimized_size=$(du -h "$output_path" | cut -f1)
        
        echo "  ✅ Optimized: $filename"
        echo "     Original: $original_size → Optimized: $optimized_size"
        echo ""
    fi
done

echo "✨ Optimization complete!"
echo ""
echo "Next steps:"
echo "1. Review the optimized videos in $OUTPUT_DIR"
echo "2. Update TutorialSteps.ts to use optimized_*.mp4 paths"
echo "3. Test the videos in your WebXR app"
echo ""

