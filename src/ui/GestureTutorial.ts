/**
 * 🎓 Interactive Gesture Tutorial System
 * 
 * Teaches users all available gestures with visual guidance
 */

import * as THREE from 'three';

interface GestureLesson {
  name: string;
  icon: string;
  description: string;
  instruction: string;
  completed: boolean;
}

export class GestureTutorial {
  private group = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private panel!: THREE.Mesh;
  
  private lessons: GestureLesson[] = [
    {
      name: 'Pinch & Drag',
      icon: '🤏',
      description: 'Move and scale objects',
      instruction: 'Pinch thumb and index finger, then move your hand',
      completed: false,
    },
    {
      name: 'Scroll',
      icon: '📜',
      description: 'Navigate through feed',
      instruction: 'Pinch and move hand up/down in the air',
      completed: false,
    },
    {
      name: 'Thumbs Up',
      icon: '👍',
      description: 'Like content',
      instruction: 'Extend thumb, curl other fingers',
      completed: false,
    },
    {
      name: 'Heart',
      icon: '❤️',
      description: 'Love content',
      instruction: 'Bring both hands together, index and thumb touching',
      completed: false,
    },
    {
      name: 'Peace Sign',
      icon: '✌️',
      description: 'Repost content',
      instruction: 'Extend index and middle fingers',
      completed: false,
    },
    {
      name: 'ILY Sign',
      icon: '🤟',
      description: 'Open keyboard',
      instruction: 'Extend thumb, index, and pinky',
      completed: false,
    },
  ];
  
  private currentLessonIndex = 0;
  private isVisible = false;
  
  constructor() {
    this.group.name = 'GestureTutorial';
    
    this.canvas = document.createElement('canvas');
    this.canvas.width = 768;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 16;
    
    this.buildPanel();
    this.group.visible = false;
  }

  private buildPanel() {
    const geo = new THREE.PlaneGeometry(0.6, 0.4);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.98,
    });
    
    this.panel = new THREE.Mesh(geo, mat);
    this.group.add(this.panel);
    
    this.updateDisplay();
  }

  private updateDisplay() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Background with gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, 'rgba(30, 30, 50, 0.98)');
    gradient.addColorStop(1, 'rgba(50, 50, 80, 0.98)');
    ctx.fillStyle = gradient;
    ctx.roundRect(0, 0, this.canvas.width, this.canvas.height, 20);
    ctx.fill();
    
    const lesson = this.lessons[this.currentLessonIndex];
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px system-ui, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Gesture Tutorial', this.canvas.width / 2, 30);
    
    // Progress
    ctx.font = '24px system-ui';
    ctx.fillStyle = '#aaaacc';
    ctx.fillText(`${this.currentLessonIndex + 1} / ${this.lessons.length}`, this.canvas.width / 2, 85);
    
    // Icon (large)
    ctx.font = '120px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lesson.icon, this.canvas.width / 2, 200);
    
    // Gesture name
    ctx.font = 'bold 36px system-ui';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(lesson.name, this.canvas.width / 2, 280);
    
    // Description
    ctx.font = '24px system-ui';
    ctx.fillStyle = '#aaaacc';
    ctx.fillText(lesson.description, this.canvas.width / 2, 330);
    
    // Instruction
    ctx.font = '20px system-ui';
    ctx.fillStyle = '#88aaff';
    
    // Word wrap instruction
    const maxWidth = this.canvas.width - 80;
    const words = lesson.instruction.split(' ');
    let line = '';
    let y = 380;
    
    words.forEach((word) => {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line, this.canvas.width / 2, y);
        line = word + ' ';
        y += 28;
      } else {
        line = testLine;
      }
    });
    ctx.fillText(line, this.canvas.width / 2, y);
    
    // Navigation hint
    ctx.font = '18px system-ui';
    ctx.fillStyle = '#666688';
    ctx.fillText('Try the gesture to continue...', this.canvas.width / 2, this.canvas.height - 30);
    
    this.texture.needsUpdate = true;
  }

  show(position: THREE.Vector3) {
    this.group.position.copy(position);
    this.group.visible = true;
    this.isVisible = true;
    this.currentLessonIndex = 0;
    
    // Reset all lessons
    this.lessons.forEach(l => l.completed = false);
    
    this.updateDisplay();
  }

  hide() {
    this.group.visible = false;
    this.isVisible = false;
  }

  completeCurrentLesson() {
    if (!this.isVisible) return;
    
    this.lessons[this.currentLessonIndex].completed = true;
    
    if (this.currentLessonIndex < this.lessons.length - 1) {
      this.currentLessonIndex++;
      this.updateDisplay();
      return false; // Not complete yet
    } else {
      // All lessons complete!
      this.showCompletion();
      return true;
    }
  }

  private showCompletion() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Celebratory background
    const gradient = ctx.createRadialGradient(
      this.canvas.width / 2, this.canvas.height / 2, 0,
      this.canvas.width / 2, this.canvas.height / 2, 400
    );
    gradient.addColorStop(0, 'rgba(100, 50, 150, 0.98)');
    gradient.addColorStop(1, 'rgba(30, 30, 50, 0.98)');
    ctx.fillStyle = gradient;
    ctx.roundRect(0, 0, this.canvas.width, this.canvas.height, 20);
    ctx.fill();
    
    // Confetti emojis
    ['🎉', '✨', '🌟', '💫', '⭐'].forEach((emoji, i) => {
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      const x = 100 + i * 140;
      const y = 80 + Math.sin(i) * 30;
      ctx.fillText(emoji, x, y);
    });
    
    // Completion message
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Awesome!', this.canvas.width / 2, this.canvas.height / 2 - 40);
    
    ctx.font = '32px system-ui';
    ctx.fillStyle = '#aaaacc';
    ctx.fillText('You mastered all gestures!', this.canvas.width / 2, this.canvas.height / 2 + 20);
    
    ctx.font = '24px system-ui';
    ctx.fillStyle = '#88aaff';
    ctx.fillText('Ready to explore', this.canvas.width / 2, this.canvas.height / 2 + 70);
    
    this.texture.needsUpdate = true;
    
    // Auto-hide after 3 seconds
    setTimeout(() => this.hide(), 3000);
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  lookAt(target: THREE.Vector3) {
    this.group.lookAt(target);
  }

  getCurrentGesture(): string {
    if (!this.isVisible) return '';
    return this.lessons[this.currentLessonIndex].name.toLowerCase().replace(/\s/g, '_');
  }
}


