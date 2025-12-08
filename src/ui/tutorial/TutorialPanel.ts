// src/ui/tutorial/TutorialPanel.ts
import * as THREE from 'three';
import type { TutorialStep } from './TutorialSteps';
import { getVideoManager } from './VideoManager';

export interface ButtonRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonRegions {
  prev: ButtonRegion;
  next: ButtonRegion;
  skip: ButtonRegion;
}

export class TutorialPanel {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly buttonRegions: ButtonRegions;
  private videoManager = getVideoManager();
  private currentVideoTexture: THREE.VideoTexture | null = null;
  private currentVideoUrl: string | null = null;
  private videoAnimationFrame: number | null = null;
  private currentStepId: string | null = null;
  private lastRenderOptions: {
    step: TutorialStep;
    progressPercentage: number;
    hoveredButton: 'prev' | 'next' | 'skip' | null;
    currentStepIndex: number;
    totalSteps: number;
  } | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 16;
    
    // Initialize button regions
    this.buttonRegions = {
      prev: { x: 0, y: 0, w: 0, h: 0 },
      next: { x: 0, y: 0, w: 0, h: 0 },
      skip: { x: 0, y: 0, w: 0, h: 0 }
    };
  }

  render(options: {
    step: TutorialStep;
    progressPercentage: number;
    hoveredButton: 'prev' | 'next' | 'skip' | null;
    currentStepIndex: number;
    totalSteps: number;
  }): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const { step, progressPercentage, hoveredButton, currentStepIndex, totalSteps } = options;
    
    // Background - grey/dark grey gradient (matching multiplayer UI theme)
    const bgGradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    bgGradient.addColorStop(0, '#3a3a3a'); // Light grey top
    bgGradient.addColorStop(1, '#1a1a1a'); // Dark grey bottom
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Title - black text
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(step.title, this.canvas.width / 2, 50);
    
    // Handle video for steps that have one
    if (step.id !== this.currentStepId) {
      // Step changed - pause previous video
      if (this.currentVideoUrl) {
        this.videoManager.pauseVideo(this.currentVideoUrl);
      }
      
      // Switch to new video if step has one
      if (step.videoSrc) {
        this.switchVideo(step.videoSrc);
      } else {
        // No video for this step
        this.currentVideoTexture = null;
        this.currentVideoUrl = null;
        if (this.videoAnimationFrame) {
          cancelAnimationFrame(this.videoAnimationFrame);
          this.videoAnimationFrame = null;
        }
      }
      this.currentStepId = step.id;
    }
    
    // Draw video if available and ready
    if (step.videoSrc && this.currentVideoTexture) {
      const video = this.videoManager.getVideo(step.videoSrc);
      if (video && this.videoManager.isReady(step.videoSrc)) {
        this.drawVideoFrame(ctx, video);
        // Start update loop if not already running
        if (!this.videoAnimationFrame) {
          this.startVideoUpdateLoop();
        }
      } else {
        // Video not ready yet - show loading indicator
        this.drawLoadingIndicator(ctx);
      }
    } else {
      // No video - show description for welcome step
      this.drawDescription(ctx, step.description);
    }
    
    // Progress bar for rotation/scale
    if ((step.id === 'rotate' || step.id === 'scale') && !step.completed) {
      const barWidth = this.canvas.width * 0.7;
      const barHeight = 12;
      const barX = (this.canvas.width - barWidth) / 2;
      const barY = this.canvas.height - 120;
      
      ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      
      const progressWidth = (barWidth * progressPercentage) / 100;
      ctx.fillStyle = '#888888'; // Grey accent for progress bar
      ctx.fillRect(barX, barY, progressWidth, barHeight);
      
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = '#000000'; // Black text
      ctx.fillText(`${Math.round(progressPercentage)}%`, this.canvas.width / 2, barY - 10);
    }
    
    // Completion message - black text
    if (step.completed) {
      ctx.font = 'bold 24px sans-serif';
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.fillText('✅ Step Complete!', this.canvas.width / 2, this.canvas.height / 2 + 100);
    }
    
    // Navigation buttons
    this.drawNavigationButtons(ctx, hoveredButton, currentStepIndex, totalSteps);
    
    // Instructions for button interaction (hand gestures only) - black text
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#000000';
    ctx.fillText('👆 Point with index finger, pinch to click', this.canvas.width / 2, this.canvas.height - 20);

    this.texture.needsUpdate = true;
    
    // Store render options for update loop
    this.lastRenderOptions = { step, progressPercentage, hoveredButton, currentStepIndex, totalSteps };
  }
  
  private switchVideo(videoSrc: string): void {
    // Stop previous video update loop
    if (this.videoAnimationFrame) {
      cancelAnimationFrame(this.videoAnimationFrame);
      this.videoAnimationFrame = null;
    }
    
    // Get preloaded video texture from VideoManager
    const texture = this.videoManager.getTexture(videoSrc);
    if (texture) {
      this.currentVideoTexture = texture;
      this.currentVideoUrl = videoSrc;
      
      // Play the video if it's ready
      if (this.videoManager.isReady(videoSrc)) {
        this.videoManager.playVideo(videoSrc);
        // Start update loop for smooth playback
        this.startVideoUpdateLoop();
      } else {
        // Video not ready yet - will show loading indicator
        console.log(`[TutorialPanel] Video not ready yet: ${videoSrc}`);
      }
    } else {
      console.warn(`[TutorialPanel] Video not preloaded: ${videoSrc}`);
      this.currentVideoTexture = null;
      this.currentVideoUrl = null;
    }
  }
  
  private startVideoUpdateLoop(): void {
    if (!this.currentVideoTexture || !this.currentVideoUrl) return;
    
    const update = () => {
      if (this.currentVideoTexture && this.currentVideoUrl && this.lastRenderOptions) {
        const video = this.videoManager.getVideo(this.currentVideoUrl);
        if (video && this.videoManager.isReady(this.currentVideoUrl) && video.readyState >= 2) {
          const ctx = this.canvas.getContext('2d')!;
          
          // Video area coordinates
          const videoY = 100;
          const videoHeight = this.canvas.height - videoY - 140;
          const videoWidth = this.canvas.width - 80;
          const videoX = 40;
          
          // Clear video area (redraw background)
          const bgGradient = ctx.createLinearGradient(0, videoY, 0, videoY + videoHeight);
          bgGradient.addColorStop(0, '#3a3a3a');
          bgGradient.addColorStop(1, '#1a1a1a');
          ctx.fillStyle = bgGradient;
          ctx.fillRect(videoX, videoY, videoWidth, videoHeight);
          
          // Redraw video frame
          this.drawVideoFrame(ctx, video);
          
          // Update texture
          this.texture.needsUpdate = true;
        }
        
        // Continue loop
        this.videoAnimationFrame = requestAnimationFrame(update);
      }
    };
    
    this.videoAnimationFrame = requestAnimationFrame(update);
  }
  
  private drawVideoFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement): void {
    if (!video || video.readyState < 2) {
      return; // Video not ready
    }
    
    // Video area: below title, above buttons
    const videoY = 100;
    const videoHeight = this.canvas.height - videoY - 140; // Leave space for buttons and hint
    const videoWidth = this.canvas.width - 80; // Margins
    const videoX = 40;
    
    // Calculate aspect ratio to maintain video proportions
    const videoAspect = video.videoWidth / video.videoHeight;
    const targetAspect = videoWidth / videoHeight;
    
    let drawWidth = videoWidth;
    let drawHeight = videoHeight;
    let drawX = videoX;
    let drawY = videoY;
    
    if (videoAspect > targetAspect) {
      // Video is wider, fit to width
      drawHeight = videoWidth / videoAspect;
      drawY = videoY + (videoHeight - drawHeight) / 2;
    } else {
      // Video is taller, fit to height
      drawWidth = videoHeight * videoAspect;
      drawX = videoX + (videoWidth - drawWidth) / 2;
    }
    
    // Draw video frame - this is called every frame for smooth playback
    ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  }
  
  private drawLoadingIndicator(ctx: CanvasRenderingContext2D): void {
    // Show lightweight loading indicator
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'center';
    ctx.fillText('Loading video...', this.canvas.width / 2, this.canvas.height / 2);
  }
  
  private drawDescription(ctx: CanvasRenderingContext2D, description: string): void {
    // Fallback: show description for welcome step (no video)
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    const maxWidth = this.canvas.width - 80;
    const words = description.split(' ');
    let line = '';
    let y = 120;
    const lineHeight = 24;
    
    words.forEach((word) => {
      const testLine = line + (line ? ' ' : '') + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line, this.canvas.width / 2, y);
        line = word;
        y += lineHeight;
      } else {
        line = testLine;
      }
    });
    if (line) {
      ctx.fillText(line, this.canvas.width / 2, y);
    }
  }
  
  dispose(): void {
    // Pause current video
    if (this.currentVideoUrl) {
      this.videoManager.pauseVideo(this.currentVideoUrl);
    }
    
    // Stop update loop
    if (this.videoAnimationFrame) {
      cancelAnimationFrame(this.videoAnimationFrame);
      this.videoAnimationFrame = null;
    }
    
    // Reset state
    this.currentVideoTexture = null;
    this.currentVideoUrl = null;
    this.currentStepId = null;
    this.lastRenderOptions = null;
  }
  
  private drawNavigationButtons(
    ctx: CanvasRenderingContext2D,
    hoveredButton: 'prev' | 'next' | 'skip' | null,
    currentStepIndex: number,
    totalSteps: number
  ): void {
    const buttonWidth = 140;
    const buttonHeight = 45;
    const buttonY = this.canvas.height - 80;
    const buttonSpacing = 20;
    const skipButtonWidth = 120; // Smaller skip button
    const skipButtonHeight = 35; // Smaller height for skip button
    const totalWidth = buttonWidth * 2 + buttonSpacing;
    const startX = (this.canvas.width - totalWidth) / 2;
    
    // Previous button
    const prevX = startX;
    const prevEnabled = currentStepIndex > 0;
    const prevHovered = hoveredButton === 'prev';
    
    ctx.fillStyle = prevHovered ? '#888888' : (prevEnabled ? '#666666' : '#444444');
    ctx.fillRect(prevX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = prevHovered ? '#aaaaaa' : (prevEnabled ? '#888888' : '#666666');
    ctx.lineWidth = prevHovered ? 3 : 2;
    ctx.strokeRect(prevX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#000000'; // Black text
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◀ Previous', prevX + buttonWidth / 2, buttonY + buttonHeight / 2 + 7);
    
    this.buttonRegions.prev = { x: prevX, y: buttonY, w: buttonWidth, h: buttonHeight };
    
    // Next button (or "Start Tutorial" on welcome step)
    const nextX = startX + buttonWidth + buttonSpacing;
    const nextEnabled = currentStepIndex < totalSteps - 1;
    const nextHovered = hoveredButton === 'next';
    
    // CRITICAL FIX: Always enable Next button on welcome step (step 0) to allow starting
    const isWelcomeStep = currentStepIndex === 0;
    const buttonEnabled = nextEnabled || isWelcomeStep;
    
    ctx.fillStyle = nextHovered ? '#888888' : (buttonEnabled ? '#666666' : '#444444');
    ctx.fillRect(nextX, buttonY, buttonWidth, buttonHeight);
    ctx.strokeStyle = nextHovered ? '#aaaaaa' : (buttonEnabled ? '#888888' : '#666666');
    ctx.lineWidth = nextHovered ? 3 : 2;
    ctx.strokeRect(nextX, buttonY, buttonWidth, buttonHeight);
    
    ctx.fillStyle = '#000000'; // Black text
    // CRITICAL FIX: Show "Start Tutorial" on welcome step, "Next ▶" on other steps
    const nextButtonText = isWelcomeStep ? 'Start Tutorial ▶' : 'Next ▶';
    ctx.font = isWelcomeStep ? 'bold 16px sans-serif' : 'bold 18px sans-serif';
    ctx.fillText(nextButtonText, nextX + buttonWidth / 2, buttonY + buttonHeight / 2 + 7);
    
    this.buttonRegions.next = { x: nextX, y: buttonY, w: buttonWidth, h: buttonHeight };
    
    // Skip Tutorial button (top right, always visible)
    const skipX = this.canvas.width - skipButtonWidth - 20;
    const skipY = 20;
    const skipHovered = hoveredButton === 'skip';
    
    ctx.fillStyle = skipHovered ? '#888888' : '#666666';
    ctx.fillRect(skipX, skipY, skipButtonWidth, skipButtonHeight);
    ctx.strokeStyle = skipHovered ? '#aaaaaa' : '#888888';
    ctx.lineWidth = skipHovered ? 3 : 2;
    ctx.strokeRect(skipX, skipY, skipButtonWidth, skipButtonHeight);
    
    ctx.fillStyle = '#000000'; // Black text
    ctx.font = 'bold 14px sans-serif'; // Smaller font
    ctx.fillText('⏭ Skip', skipX + skipButtonWidth / 2, skipY + skipButtonHeight / 2 + 5);
    
    this.buttonRegions.skip = { x: skipX, y: skipY, w: skipButtonWidth, h: skipButtonHeight };
  }
}

