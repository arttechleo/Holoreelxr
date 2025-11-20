/**
 * Application-wide constants and configuration values.
 * Centralizes magic numbers and thresholds for easier tuning.
 */

// ========== GESTURE THRESHOLDS ==========
export const GESTURE = {
  /** Distance (m) between thumb and index tips to register pinch */
  PINCH_THRESHOLD: 0.035,
  
  /** Distance (m) for heart gesture (index fingers collide + thumbs collide) */
  HEART_THRESHOLD: 0.18,
  
  /** Min distance (m) from wrist for extended fingers */
  FINGER_EXTENDED_THRESHOLD: 0.085,
  
  /** Max distance (m) from wrist for curled fingers */
  FINGER_CURLED_THRESHOLD: 0.075,
  
  /** Thumb extension threshold (m) */
  THUMB_EXTENDED_THRESHOLD: 0.080,
  
  /** Gesture stabilization time (ms) - optimized for heart gesture reliability */
  SETTLE_TIME_MS: 80,
  
  /** Number of frames for gesture smoothing - more frames for heart gesture */
  SMOOTH_FRAMES: 4,
  
  /** Minimum stable hold before accepting gesture (ms) - smooth experience */
  HOLD_TIME_MS: 120,
} as const;

// ========== INTERACTION CONTROLS ==========
export const CONTROLS = {
  /** Scroll threshold: vertical displacement to trigger feed change (m) - OPTIMIZED */
  SCROLL_DISPLACEMENT: 0.022,
  
  /** Cooldown between scroll actions (ms) - REDUCED for faster scrolling */
  SCROLL_COOLDOWN_MS: 250,
  
  /** Minimum vertical velocity to register scroll (m/s) - REDUCED for more responsive scrolling */
  SCROLL_MIN_VELOCITY: 0.006,
  
  /** Distance from object to allow "in air" scrolling (m) - INCREASED for easier scrolling */
  SCROLL_IN_AIR_DISTANCE: 0.25,
  
  /** Distance from object to start armed for scrolling (m) - REDUCED for easier activation */
  SCROLL_START_DISTANCE: 0.15,
  
  /** Minimum pinch hold time before scroll is allowed (ms) - REDUCED for faster response */
  SCROLL_MIN_HOLD_MS: 80,
  
  /** Low-pass filter alpha for scroll smoothing - INCREASED for smoother tracking */
  SCROLL_LPF_ALPHA: 0.28,
} as const;

// ========== GRAB & TRANSFORM ==========
export const TRANSFORM = {
  /** Distance from object surface for instant grab (m) */
  INSTANT_GRAB_DISTANCE: 0.14,
  
  /** Hold time before pending grab activates (ms) */
  GRAB_HOLD_MS: 150,
  
  /** Movement threshold to cancel pending grab (m) */
  GRAB_CANCEL_MOVEMENT: 0.06,
  
  /** Max distance for grab to be available (m) */
  GRAB_MAX_DISTANCE: 0.18,
  
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
} as const;

// ========== REACTION COOLDOWNS ==========
export const REACTIONS = {
  /** Cooldown between same reaction type (ms) - smooth UX */
  COOLDOWN_MS: 1000,
  
  /** Distance threshold for "hands together" detection (m) */
  CLUSTER_DISTANCE: 0.11,
  
  /** Vertical offset below object to consider hands "low" (m) */
  CLUSTER_Y_OFFSET: -0.06,
  
  /** Cooldown when hands are clustered together (ms) */
  CLUSTER_COOLDOWN_MS: 450,
  
  /** Gesture must be stable for this duration (ms) - REDUCED for faster recognition */
  GESTURE_STABLE_MS: 100,
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
  LOG_GESTURES: false,
  
  /** Enable performance monitoring */
  SHOW_STATS: false,
  
  /** Enable visual debug helpers */
  SHOW_DEBUG_RAYS: true,
} as const;

