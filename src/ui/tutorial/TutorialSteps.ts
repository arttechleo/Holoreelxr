// src/ui/tutorial/TutorialSteps.ts

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  detailedInstructions: string;
  shape: 'sphere' | 'pyramid' | 'box';
  color: string;
  gesture?: string;
  completed: boolean;
  videoSrc?: string; // Path to gesture demo video
  posterSrc?: string; // Path to static poster image (fallback for slow video loading)
}

/**
 * Default tutorial steps for onboarding
 * 
 * NOTE: videoSrc paths must always point to files that actually exist in /public/gestuivideo.
 * Prefer optimized_*.mp4 under /gestuivideo/optimized/ if present, otherwise fall back
 * to the original /gestuivideo/*.mp4 assets.
 */
export function createDefaultTutorialSteps(): TutorialStep[] {
  return [
    {
      id: 'welcome',
      title: '🎉 Welcome to HoloreelXR!',
      description: 'Hand gesture-based 3D social feed',
      detailedInstructions: 'Interact with the 3D model using hand gestures. When you first interact with it, the tutorial will guide you through each gesture.',
      shape: 'box',
      color: '#667eea',
      completed: false,
      // No video for welcome step
    },
    {
      id: 'rotate',
      title: '🔄 Rotate 3D Objects',
      description: 'Two-hand rotation gesture',
      detailedInstructions: 'Pinch with BOTH hands on the cube. Move your hands in a circular motion to rotate it. Rotate at least 30 degrees.',
      shape: 'box',
      color: '#4ECDC4',
      gesture: 'twohandrotate',
      completed: false,
      videoSrc: '/gestuivideo/Rotate.mp4',
      posterSrc: '/gestuivideo/posters/rotate.png',
    },
    {
      id: 'scale',
      title: '📏 Scale Objects',
      description: 'Two-hand scaling gesture',
      detailedInstructions: 'Pinch with BOTH hands on the cube. Move your hands closer together to shrink, or farther apart to enlarge.',
      shape: 'box',
      color: '#95E1D3',
      gesture: 'twohandscale',
      completed: false,
      videoSrc: '/gestuivideo/Scale.mp4',
      posterSrc: '/gestuivideo/posters/scale.png',
    },
    {
      id: 'grab',
      title: '✋ Grab and Move',
      description: 'Single-hand grab gesture',
      detailedInstructions: 'Pinch with ONE hand to grab the cube (works from any distance!). Move your hand to reposition it, then release the pinch to place it in the new location.',
      shape: 'box',
      color: '#FF6B6B',
      gesture: 'grab',
      completed: false,
      videoSrc: '/gestuivideo/Grab.mp4',
      posterSrc: '/gestuivideo/posters/grab.png',
    },
    {
      id: 'scroll',
      title: '📜 Scroll Feed',
      description: 'Navigate through content',
      detailedInstructions: 'Pinch with ONE hand away from the object. Move your hand UP or DOWN to scroll through the feed.',
      shape: 'sphere',
      color: '#6BCF7F',
      gesture: 'scroll',
      completed: false,
      videoSrc: '/gestuivideo/Scroll.mp4',
      posterSrc: '/gestuivideo/posters/scroll.png',
    },
    {
      id: 'like',
      title: '👍 Like Content',
      description: 'Thumbs up gesture',
      detailedInstructions: 'Extend your thumb upward while keeping other fingers curled. Hold the gesture to like.',
      shape: 'sphere',
      color: '#F38181',
      gesture: 'thumbsup',
      completed: false,
      videoSrc: '/gestuivideo/ThumsUp.mp4',
      posterSrc: '/gestuivideo/posters/thumbsup.png',
    },
    {
      id: 'heart',
      title: '❤️ Save Content',
      description: 'Heart gesture',
      detailedInstructions: 'Bring BOTH hands together. Touch index fingers together, then thumbs together.',
      shape: 'box',
      color: '#AA96DA',
      gesture: 'heart',
      completed: false,
      videoSrc: '/gestuivideo/Heart.mp4',
      posterSrc: '/gestuivideo/posters/heart.png',
    },
    {
      id: 'repost',
      title: '✌️ Repost Content',
      description: 'Peace sign gesture',
      detailedInstructions: 'Extend your index and middle fingers (peace sign) while keeping ring and pinky curled.',
      shape: 'pyramid',
      color: '#FFD93D',
      gesture: 'peace',
      completed: false,
      videoSrc: '/gestuivideo/Repost.mp4',
      posterSrc: '/gestuivideo/posters/repost.png',
    },
  ];
}

