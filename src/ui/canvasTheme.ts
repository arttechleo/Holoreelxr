// src/ui/canvasTheme.ts
/**
 * Shared canvas theme utilities for consistent styling across all canvas-based UI panels.
 * Reads CSS custom properties from :root and provides helpers for rounded rectangles and backgrounds.
 */

export interface CanvasTheme {
  canvasBgTop: string;
  canvasBgBottom: string;
  panelBorder: string;
  panelBorderHover: string;
  accent: string;
  cta: string;
  chip: string;
  chipHover: string;
  textPrimary: string;
  textSecondary: string;
  textDim: string;
}

export const defaultCanvasTheme: CanvasTheme = {
  canvasBgTop: '#30303a',
  canvasBgBottom: '#111118',
  panelBorder: 'rgba(255,255,255,0.10)',
  panelBorderHover: '#9b87ff',
  accent: '#9b87ff',
  cta: '#ff6f61',
  chip: 'rgba(255,255,255,0.06)',
  chipHover: 'rgba(255,255,255,0.16)',
  textPrimary: '#f9fafb',
  textSecondary: 'rgba(249,250,251,0.65)',
  textDim: 'rgba(249,250,251,0.40)',
};

/**
 * Read canvas theme from CSS custom properties.
 * Falls back to defaultCanvasTheme if CSS variables are not available.
 */
export function readCanvasThemeFromCSS(): CanvasTheme {
  if (typeof window === 'undefined' || !document?.documentElement) {
    return defaultCanvasTheme;
  }

  const root = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = root.getPropertyValue(name);
    return value && value.trim().length > 0 ? value.trim() : fallback;
  };

  return {
    canvasBgTop: read('--canvas-bg-gradient-top', defaultCanvasTheme.canvasBgTop),
    canvasBgBottom: read('--canvas-bg-gradient-bottom', defaultCanvasTheme.canvasBgBottom),
    panelBorder: read('--border-subtle', defaultCanvasTheme.panelBorder),
    panelBorderHover: read('--accent', defaultCanvasTheme.panelBorderHover),
    accent: read('--accent', defaultCanvasTheme.accent),
    cta: read('--cta', defaultCanvasTheme.cta),
    chip: read('--bg-chip', defaultCanvasTheme.chip),
    chipHover: read('--bg-chip-hover', defaultCanvasTheme.chipHover),
    textPrimary: read('--text-primary', defaultCanvasTheme.textPrimary),
    textSecondary: read('--text-secondary', defaultCanvasTheme.textSecondary),
    textDim: read('--text-dim', defaultCanvasTheme.textDim),
  };
}

/**
 * Draw a rounded rectangle on the canvas.
 * @param ctx Canvas rendering context
 * @param x Left position
 * @param y Top position
 * @param w Width
 * @param h Height
 * @param r Border radius (clamped to fit within dimensions)
 */
export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Apply the standard panel background gradient.
 * @param ctx Canvas rendering context
 * @param w Canvas width
 * @param h Canvas height
 * @param theme Theme to use for colors
 */
export function applyPanelBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: CanvasTheme
) {
  const bgGradient = ctx.createLinearGradient(0, 0, 0, h);
  bgGradient.addColorStop(0, theme.canvasBgTop);
  bgGradient.addColorStop(1, theme.canvasBgBottom);
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, w, h);
}

