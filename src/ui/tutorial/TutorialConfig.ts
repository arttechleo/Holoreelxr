// src/ui/tutorial/TutorialConfig.ts

/**
 * Configuration flags for tutorial video rendering.
 * 
 * USE_GESTURE_POSTERS_INSTEAD_OF_VIDEO: When true, tutorial will use static poster images
 * instead of videos. This provides instant display with no loading delay, useful for
 * constrained hardware (e.g., Quest headsets) where video decoding can be slow.
 * 
 * Set to true to enable poster fallback mode.
 */
export const USE_GESTURE_POSTERS_INSTEAD_OF_VIDEO = false; // TEMP: fallback until videos are fast enough

