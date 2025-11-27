/**
 * Application-wide constants and configuration values.
 * Centralizes magic numbers and thresholds for easier tuning.
 */

import { PRODUCTION_CONFIG } from './production';

// ========== GESTURE THRESHOLDS ==========
export const GESTURE = {
  /** Distance (m) between thumb and index tips to register pinch */
  PINCH_THRESHOLD: 0.035,
  
  /** Distance (m) for heart gesture pair collisions (index↔index & thumb↔thumb) - MORE LENIENT for easier detection */
  HEART_THRESHOLD: 0.18,
  
  /** Average distance (m) between both pairs to still consider it a heart - MORE LENIENT for shape detection */
  HEART_COMBINED_THRESHOLD: 0.22,
  
  /** Cross-hand thumb/index proximity threshold (m) for relaxed detection */
  HEART_CROSS_THRESHOLD: 0.17,
  
  /** Min distance (m) from wrist for extended fingers */
  FINGER_EXTENDED_THRESHOLD: 0.085,
  
  /** Max distance (m) from wrist for curled fingers */
  FINGER_CURLED_THRESHOLD: 0.075,
  
  /** Thumb extension threshold (m) */
  THUMB_EXTENDED_THRESHOLD: 0.080,
  
  /** Gesture stabilization time (ms) - optimized for heart gesture reliability */
  SETTLE_TIME_MS: 70,
  
  /** Number of frames for gesture smoothing - more frames for heart gesture */
  SMOOTH_FRAMES: 4,
  
  /** Minimum stable hold before accepting gesture (ms) - smooth experience */
  HOLD_TIME_MS: 120,
} as const;

// ========== INTERACTION CONTROLS ==========
export const CONTROLS = {
  /** Scroll threshold: vertical displacement to trigger feed change (m) - 1.5cm for responsive scrolling */
  SCROLL_DISPLACEMENT: 0.015,
  
  /** Cooldown between scroll actions (ms) - Set to 800ms to prevent too-fast scrolling */
  SCROLL_COOLDOWN_MS: 800,
  
  /** Minimum vertical velocity to register scroll (m/s) */
  SCROLL_MIN_VELOCITY: 0.002,
  
  /** Minimum pinch hold time before scroll is allowed (ms) - Short delay to detect scroll intent */
  SCROLL_MIN_HOLD_MS: 30,
  
  /** Low-pass filter alpha for scroll smoothing - Balanced for responsive yet smooth tracking */
  SCROLL_LPF_ALPHA: 0.4,
} as const;

// ========== GRAB & TRANSFORM ==========
export const TRANSFORM = {
  /** Distance from object surface for instant grab (m) */
  INSTANT_GRAB_DISTANCE: 0.10,
  
  /** Maximum distance for grab to be available (m) */
  GRAB_MAX_DISTANCE: 0.20,
  
  /** Hold time before pending grab activates (ms) - Longer to prevent scroll conflicts */
  GRAB_HOLD_MS: 250,
  
  /** Movement threshold to cancel pending grab (m) - Must stay stationary */
  GRAB_CANCEL_MOVEMENT: 0.03,
  
  /** Scale limits */
  SCALE_MIN: 0.15,
  SCALE_MAX: 8.0,
  
  /** Two-hand scale sensitivity multiplier */
  SCALE_GAIN: 2.2,
  
  /** Deadband for scale changes to avoid jitter */
  SCALE_DEADBAND: 0.004,
  
  /** Low-pass filter alpha for two-hand distance smoothing */
  TWO_HAND_LPF_ALPHA: 0.28,
  
  /** Rotation gain multiplier */
  ROTATION_GAIN: 0.9,
  
  /** Rotation deadzone (radians) */
  ROTATION_DEADZONE_RAD: Math.PI / 180, // 1 degree
  
  /** Max rotation change per update (radians) */
  ROTATION_MAX_DELTA_RAD: (60 * Math.PI) / 180, // 60 degrees
  
  /** Rotation smoothing time (seconds) */
  ROTATION_SMOOTH_TIME: 0.12,
  
  /** Max rotation speed (radians/s) */
  ROTATION_MAX_SPEED_RAD: (360 * Math.PI) / 180, // 360 deg/s
  
  /** Minimum movement to consider for rotation (m) */
  MIN_MOVEMENT_FOR_ROTATION: 0.006,
  
  /** Grab zone distance threshold (m) - within this distance, grab is prioritized over scroll */
  GRAB_ZONE_DISTANCE: 0.10,
  
  /** Surface offset for distance calculations (m) */
  SURFACE_OFFSET: 0.04,
} as const;

// ========== REACTION COOLDOWNS ==========
export const REACTIONS = {
  /** Cooldown between same reaction type (ms) - REDUCED for more responsive heart gesture */
  COOLDOWN_MS: 800,
  
  /** Distance threshold for "hands together" detection (m) */
  CLUSTER_DISTANCE: 0.11,
  
  /** Vertical offset below object to consider hands "low" (m) */
  CLUSTER_Y_OFFSET: -0.06,
  
  /** Cooldown when hands are clustered together (ms) */
  CLUSTER_COOLDOWN_MS: 450,
  
  /** Gesture must be stable for this duration (ms) - REDUCED for faster recognition, especially heart gesture */
  GESTURE_STABLE_MS: 80,
} as const;

// ========== UI & HUD ==========
export const HUD = {
  /** Dwell time to activate UI button via gaze (ms) */
  DWELL_TIME_MS: 350,
  
  /** Panel dimensions (meters) */
  PANEL_WIDTH: 0.50,
  PANEL_HEIGHT: 0.30,
  
  /** Canvas resolution for crisp text */
  CANVAS_WIDTH: 1152,
  CANVAS_HEIGHT: 640,
  
  /** Vertical offset above object (m) */
  VERTICAL_OFFSET: 0.22,
  
  /** Hit detection thickness (m) */
  HIT_THICKNESS: 0.08,
  
  /** Scroll step size for comments (pixels) */
  COMMENT_SCROLL_STEP: 42,
} as const;

// ========== MULTIPLAYER ==========
export const MULTIPLAYER = {
  /** UI priority duration after interaction (ms) - how long UI stays prioritized */
  UI_PRIORITY_DURATION_MS: 2000,
  
  /** Distance threshold for "far from object" UI priority (m) */
  FAR_FROM_OBJECT_DISTANCE: 0.3,
  
  /** Connection timeout (ms) */
  CONNECTION_TIMEOUT_MS: 10000,
  
  /** Hand update interval (ms) - throttling for network efficiency */
  HAND_UPDATE_INTERVAL_MS: 50,
  
  /** Click debounce time (ms) - prevents rapid-fire clicks */
  CLICK_DEBOUNCE_MS: 500,
  
  /** Touch threshold for button interaction (m) - increased for more comfortable hand tracking */
  BUTTON_TOUCH_THRESHOLD: 0.05,
  
  /** Raycast hit thickness multiplier - increased for easier interaction */
  RAYCAST_THICKNESS_MULTIPLIER: 1.5,
  
  /** Hover glow fill time (ms) - time to fill border glow from 0% to 100% */
  HOVER_GLOW_FILL_TIME_MS: 800,
  
  /** Minimum hover time before button can be clicked (ms) - prevents accidental clicks */
  MIN_HOVER_TIME_MS: 100,
  
  /** Panel dimming opacity when keypad is active (0.0 to 1.0) */
  PANEL_DIMMED_OPACITY: 0.4,
} as const;

// ========== VISUAL EFFECTS ==========
export const VFX = {
  /** Platform pulse duration (seconds) */
  PLATFORM_PULSE_DURATION: 0.7,
  
  /** Platform pulse fade time (ms) */
  PLATFORM_FADE_MS: 450,
  
  /** Emoji particle lifetime (seconds) */
  EMOJI_LIFETIME: 0.45,
  
  /** Emoji launch speed multiplier */
  EMOJI_SPEED_FACTOR: 0.35,
  
  /** Reaction chip particle lifetime (seconds) */
  CHIP_LIFETIME: 0.9,
} as const;

// ========== CONTENT & FEED ==========
export const FEED = {
  /** Default feed JSON URL */
  DEFAULT_FEED_URL: '/feed.json',
  
  /** Initial spawn position if none set */
  DEFAULT_SPAWN_Y: 0.5,
  
  /** Distance in front of camera for initial placement (m) */
  PLACEMENT_DISTANCE: 1.0,
  
  /** PLY loader point size */
  PLY_POINT_SIZE: 0.01,
  
  /** Default FPS for animated sequences */
  DEFAULT_FPS: 30,
} as const;

// ========== LIGHTING ==========
export const LIGHTING = {
  /** Hemisphere light intensity */
  AMBIENT_INTENSITY: 0.9,
  
  /** Sky color for hemisphere light */
  SKY_COLOR: 0xffffff,
  
  /** Ground color for hemisphere light */
  GROUND_COLOR: 0x222233,
} as const;

// ========== CAMERA ==========
export const CAMERA = {
  /** Field of view (degrees) */
  FOV: 70,
  
  /** Near clipping plane (m) */
  NEAR: 0.01,
  
  /** Far clipping plane (m) */
  FAR: 100,
} as const;

// ========== DEBUG ==========
export const DEBUG = {
  /** Enable console logging for gestures */
  LOG_GESTURES: PRODUCTION_CONFIG.ENABLE_DEBUG_LOGS,
  
  /** Enable performance monitoring */
  SHOW_STATS: PRODUCTION_CONFIG.ENABLE_PERFORMANCE_MONITORING,
  
  /** Enable visual debug helpers */
  SHOW_DEBUG_RAYS: PRODUCTION_CONFIG.SHOW_DEBUG_HELPERS,
  
  /** Enable FPS counter */
  SHOW_FPS_COUNTER: PRODUCTION_CONFIG.SHOW_FPS_COUNTER,
} as const;

