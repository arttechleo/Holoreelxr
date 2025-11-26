/**
 * Type definitions for tutorial system
 * Improves type safety and removes 'as any' casts
 */

export interface OnboardingTutorial {
  getCurrentGesture(): string | null;
  isGrabStepActive(): boolean;
  isScrollStepActive(): boolean;
  isTutorialActive(): boolean;
  shouldShowReactionHud(): boolean;
  completeCurrentLesson(): void;
  getGroup(): THREE.Group;
}

