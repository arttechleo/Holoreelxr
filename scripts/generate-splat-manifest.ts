/**
 * Generate splats-manifest.json by scanning public/assets/ for .spz files.
 * 
 * This script:
 * 1. Scans public/assets/ (and optionally subfolders) for .spz files
 * 2. Writes public/assets/splats-manifest.json with the list of URLs
 * 3. Overwrites the file on each run
 * 
 * Run with: npm run generate:splats
 * Or it will run automatically before dev/build if configured in package.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const ASSETS_DIR = path.join(projectRoot, 'public', 'assets');
const MANIFEST_PATH = path.join(ASSETS_DIR, 'splats-manifest.json');

interface SplatManifest {
  splats: string[];
}

/**
 * Recursively find all .spz files in a directory
 */
function findSplatFiles(dir: string, basePath: string = ''): string[] {
  const results: string[] = [];
  
  if (!fs.existsSync(dir)) {
    console.warn(`[generate-splat-manifest] Directory does not exist: ${dir}`);
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name).replace(/\\/g, '/'); // Normalize to forward slashes

    if (entry.isDirectory()) {
      // Recursively search subdirectories
      results.push(...findSplatFiles(fullPath, relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.spz')) {
      // Convert to HTTP URL path (as seen by browser)
      // public/assets/file.spz -> /assets/file.spz
      const url = `/assets/${relativePath}`;
      results.push(url);
    }
  }

  return results;
}

/**
 * Generate the manifest file
 */
function generateManifest(): void {
  console.log(`[generate-splat-manifest] Scanning ${ASSETS_DIR} for .spz files...`);

  const splats = findSplatFiles(ASSETS_DIR);

  if (splats.length === 0) {
    console.warn(`[generate-splat-manifest] ⚠️ No .spz files found in ${ASSETS_DIR}`);
    console.warn(`[generate-splat-manifest] 💡 Add .spz files to public/assets/ and run this script again`);
  } else {
    console.log(`[generate-splat-manifest] ✅ Found ${splats.length} .spz file(s):`);
    splats.forEach((url, i) => {
      console.log(`[generate-splat-manifest]   ${i + 1}. ${url}`);
    });
  }

  const manifest: SplatManifest = {
    splats: splats.sort() // Sort alphabetically for consistent ordering
  };

  // Ensure assets directory exists
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // Write manifest file
  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  );

  console.log(`[generate-splat-manifest] ✅ Manifest written to: ${MANIFEST_PATH}`);
}

// Run if called directly
generateManifest();

export { generateManifest };

