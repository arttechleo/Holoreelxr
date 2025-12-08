#!/usr/bin/env node
/**
 * Optimize tutorial gesture videos for WebXR (Cross-platform Node.js version)
 * Requirements: ffmpeg must be installed
 * Usage: node scripts/optimize-tutorial-videos.js
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const INPUT_DIR = join(projectRoot, 'public', 'gestuivideo');
const OUTPUT_DIR = join(projectRoot, 'public', 'gestuivideo', 'optimized');

function checkFFmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function formatFileSize(bytes) {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function optimizeVideo(inputPath, outputPath) {
  const filename = basename(inputPath);
  console.log(`Processing: ${filename}`);
  
  try {
    // Optimize for WebXR:
    // - 480p resolution (854x480 for 16:9, scales to fit)
    // - 30fps
    // - H.264 with fast preset and zero latency tuning
    // - 1Mbps bitrate (small files, fast loading)
    // - faststart flag (moov atom at front for instant playback)
    // - Remove audio track (smaller files)
    execSync(
      `ffmpeg -i "${inputPath}" ` +
      `-vf "scale=854:-2" ` +
      `-r 30 ` +
      `-c:v libx264 ` +
      `-preset veryfast ` +
      `-profile:v main ` +
      `-tune zerolatency ` +
      `-b:v 1000k ` +
      `-maxrate 1200k ` +
      `-bufsize 2000k ` +
      `-g 60 ` +
      `-movflags +faststart ` +
      `-an ` +
      `-y ` +
      `"${outputPath}"`,
      { stdio: 'inherit' }
    );
    
    // Get file sizes for comparison
    const originalSize = statSync(inputPath).size;
    const optimizedSize = statSync(outputPath).size;
    const reduction = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
    
    console.log(`  ✅ Optimized: ${filename}`);
    console.log(`     Original: ${formatFileSize(originalSize)} → Optimized: ${formatFileSize(optimizedSize)} (${reduction}% reduction)`);
    console.log('');
    
    return true;
  } catch (error) {
    console.error(`  ❌ Error processing ${filename}:`, error.message);
    return false;
  }
}

function main() {
  console.log('🎬 Optimizing tutorial videos for WebXR...');
  console.log(`Input: ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');
  
  // Check if ffmpeg is installed
  if (!checkFFmpeg()) {
    console.error('❌ Error: ffmpeg is not installed');
    console.error('Install it with:');
    console.error('  - Mac: brew install ffmpeg');
    console.error('  - Linux: apt-get install ffmpeg or yum install ffmpeg');
    console.error('  - Windows: Download from https://ffmpeg.org/download.html');
    process.exit(1);
  }
  
  // Check if input directory exists
  if (!existsSync(INPUT_DIR)) {
    console.error(`❌ Error: Input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }
  
  // Create output directory if it doesn't exist
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Get all MP4 files
  const files = readdirSync(INPUT_DIR).filter(file => file.endsWith('.mp4'));
  
  if (files.length === 0) {
    console.error(`❌ No MP4 files found in ${INPUT_DIR}`);
    process.exit(1);
  }
  
  console.log(`Found ${files.length} video(s) to optimize\n`);
  
  let successCount = 0;
  let failCount = 0;
  
  // Process each video
  for (const file of files) {
    const inputPath = join(INPUT_DIR, file);
    const outputPath = join(OUTPUT_DIR, file);
    
    if (optimizeVideo(inputPath, outputPath)) {
      successCount++;
    } else {
      failCount++;
    }
  }
  
  console.log('✨ Optimization complete!');
  console.log(`   ✅ Success: ${successCount}`);
  if (failCount > 0) {
    console.log(`   ❌ Failed: ${failCount}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('1. Review the optimized videos in public/gestuivideo/optimized/');
  console.log('2. Update TutorialSteps.ts to use optimized_*.mp4 paths (or keep same names)');
  console.log('3. Test the videos in your WebXR app');
  console.log('');
}

main();

