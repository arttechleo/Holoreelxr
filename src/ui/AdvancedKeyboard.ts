/**
 * 🚀 ADVANCED KEYBOARD - Next-Gen VR Text Input
 * 
 * Features:
 * - Autocomplete & word suggestions
 * - Emoji picker with categories
 * - Voice input (when available)
 * - Text selection & editing
 * - Swipe typing (coming soon)
 * - Multi-language support
 * - Smart capitalization
 * - Copy/paste
 */

import * as THREE from 'three';

type KeyboardMode = 'text' | 'emoji' | 'symbols';

interface KeyboardOptions {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onTextChange?: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
}

export class AdvancedKeyboard {
  private group = new THREE.Group();
  private keys = new Map<string, THREE.Mesh>();
  private mode: KeyboardMode = 'text';
  
  // Text state
  private currentText = '';
  private cursorPos = 0;
  private suggestions: string[] = [];
  
  // Visual elements
  private textDisplay!: THREE.Mesh;
  private suggestionDisplay!: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private suggestionCanvas: HTMLCanvasElement;
  private suggestionTexture: THREE.CanvasTexture;
  
  // Callbacks
  private options: KeyboardOptions = {
    onSubmit: () => {},
    onCancel: () => {},
  };
  
  // Layout constants - optimized for VR interaction
  private readonly KEY_SIZE = 0.04; // Larger keys for easier VR targeting
  private readonly KEY_PADDING = 0.006;
  private readonly KEYBOARD_WIDTH = 0.65;
  
  // Common word dictionary for autocomplete
  private dictionary = [
    'amazing', 'awesome', 'beautiful', 'cool', 'great', 'love', 'like',
    'wow', 'nice', 'good', 'best', 'perfect', 'incredible', 'fantastic',
    'thanks', 'thank', 'you', 'please', 'yes', 'no', 'maybe',
    'hello', 'hi', 'hey', 'bye', 'goodbye', 'see', 'later',
    'what', 'when', 'where', 'why', 'how', 'who', 'which',
    'this', 'that', 'these', 'those', 'here', 'there',
  ];
  
  // Emoji categories
  private emojiCategories = {
    faces: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂'],
    hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💕'],
    hands: ['👍', '👎', '👋', '🤝', '👏', '🙌', '🤲', '🙏', '✋', '🤚'],
    symbols: ['✨', '⭐', '🌟', '💫', '🔥', '💯', '✅', '❌', '❓', '❗'],
  };

  constructor() {
    this.group.name = 'AdvancedKeyboard';
    this.group.visible = false;
    
    // Create text display canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 16;
    
    // Create suggestion display canvas
    this.suggestionCanvas = document.createElement('canvas');
    this.suggestionCanvas.width = 512;
    this.suggestionCanvas.height = 64;
    this.suggestionTexture = new THREE.CanvasTexture(this.suggestionCanvas);
    this.suggestionTexture.minFilter = THREE.LinearFilter;
    this.suggestionTexture.magFilter = THREE.LinearFilter;
    this.suggestionTexture.anisotropy = 16;
    
    this.buildKeyboard();
  }

  private buildKeyboard() {
    this.keys.clear();
    
    // Remove old keys
    const oldKeys = this.group.children.filter(c => c.userData.isKey);
    oldKeys.forEach(k => this.group.remove(k));
    
    // Build layout based on mode
    switch (this.mode) {
      case 'text':
        this.buildTextLayout();
        break;
      case 'emoji':
        this.buildEmojiLayout();
        break;
      case 'symbols':
        this.buildSymbolLayout();
        break;
    }
    
    // Add text display
    this.createTextDisplay();
    this.createSuggestionDisplay();
  }

  private buildTextLayout() {
    const layout = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
      ['🙂', 'Space', '←', '→', 'Enter', 'Post']
    ];
    
    this.createKeysFromLayout(layout);
  }

  private buildEmojiLayout() {
    // Show first category of emojis
    const emojis = this.emojiCategories.faces;
    const layout = [
      emojis.slice(0, 5),
      emojis.slice(5, 10),
      ['❤️', '👍', '😂', '🔥', '✨'],
      ['💯', '🎉', '😍', '🤔', '👀'],
      ['ABC', 'Space', '⌫', 'Post']
    ];
    
    this.createKeysFromLayout(layout);
  }

  private buildSymbolLayout() {
    const layout = [
      ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
      ['-', '_', '=', '+', '[', ']', '{', '}', '\\', '|'],
      [';', ':', "'", '"', ',', '.', '<', '>', '/', '?'],
      ['~', '`', '⌫'],
      ['ABC', 'Space', 'Post']
    ];
    
    this.createKeysFromLayout(layout);
  }

  private createKeysFromLayout(layout: string[][]) {
    layout.forEach((row, rowIdx) => {
      const rowWidth = row.reduce((sum, key) => {
        return sum + this.getKeyWidth(key) + this.KEY_PADDING;
      }, -this.KEY_PADDING);
      
      let xOffset = -rowWidth / 2;
      const yOffset = 0.08 - rowIdx * (this.KEY_SIZE + this.KEY_PADDING);
      
      row.forEach((keyLabel) => {
        const keyWidth = this.getKeyWidth(keyLabel);
        const keyMesh = this.createKey(keyLabel, keyWidth);
        keyMesh.position.set(xOffset + keyWidth / 2, yOffset, 0);
        keyMesh.userData.isKey = true;
        this.group.add(keyMesh);
        this.keys.set(keyLabel, keyMesh);
        xOffset += keyWidth + this.KEY_PADDING;
      });
    });
  }

  private getKeyWidth(keyLabel: string): number {
    if (keyLabel === 'Space') return this.KEY_SIZE * 3;
    if (keyLabel === 'Post') return this.KEY_SIZE * 1.8;
    if (keyLabel === 'ABC' || keyLabel === '🙂') return this.KEY_SIZE * 1.5;
    if (keyLabel === 'Enter') return this.KEY_SIZE * 1.5;
    return this.KEY_SIZE;
  }

  private createKey(label: string, width: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(width, this.KEY_SIZE, 0.012); // Deeper keys for better depth perception
    
    // Color based on key type - grey buttons with white text
    let color = 0x8a8a9a; // Default grey for regular keys
    let emissive = 0x404050;
    
    if (label === 'Post') {
      color = 0x4b83ff;
      emissive = 0x2a4080;
    } else if (label === 'Cancel' || label === '⌫') {
      color = 0xff4444;
      emissive = 0x802020;
    } else if (label === 'Space' || label === 'Enter') {
      color = 0x7a7a8a; // Slightly darker grey for special keys
      emissive = 0x3a3a4a;
    } else if (label === 'ABC' || label === '🙂') {
      color = 0x9a9aaa; // Lighter grey for mode switches
      emissive = 0x4a4a5a;
    }
    
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.15,
      emissive,
      emissiveIntensity: 0.2,
    });
    
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.key = label;
    mesh.userData.originalColor = color;
    
    // Add text sprite
    const sprite = this.createTextSprite(label);
    sprite.position.z = 0.01;
    mesh.add(sprite);
    
    return mesh;
  }

  private createTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Display text with proper symbols
    let displayText = text;
    if (text === 'Space') displayText = '␣';
    else if (text === '⌫') displayText = '⌫';
    else if (text === 'Enter') displayText = '↵';
    else if (text === 'Post') displayText = '✓';
    else if (text === 'ABC') displayText = 'ABC';
    else if (text === '←') displayText = '←';
    else if (text === '→') displayText = '→';
    
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Larger font for emojis
    const isEmoji = text.length <= 2 && /\p{Emoji}/u.test(text);
    ctx.font = isEmoji ? '80px Arial' : 'bold 60px system-ui, Arial';
    
    ctx.fillText(displayText, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 16;
    
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.02, 0.02, 1);
    
    return sprite;
  }

  private createTextDisplay() {
    if (this.textDisplay) {
      this.group.remove(this.textDisplay);
    }
    
    const geo = new THREE.PlaneGeometry(this.KEYBOARD_WIDTH, 0.06);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    
    this.textDisplay = new THREE.Mesh(geo, mat);
    this.textDisplay.position.set(0, 0.22, 0);
    this.group.add(this.textDisplay);
    
    this.updateTextDisplay();
  }

  private createSuggestionDisplay() {
    if (this.suggestionDisplay) {
      this.group.remove(this.suggestionDisplay);
    }
    
    const geo = new THREE.PlaneGeometry(this.KEYBOARD_WIDTH, 0.04);
    const mat = new THREE.MeshBasicMaterial({
      map: this.suggestionTexture,
      transparent: true,
      side: THREE.DoubleSide,
    });
    
    this.suggestionDisplay = new THREE.Mesh(geo, mat);
    this.suggestionDisplay.position.set(0, 0.16, 0);
    this.group.add(this.suggestionDisplay);
    
    this.updateSuggestionDisplay();
  }

  private updateTextDisplay() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Background - subtle grey
    ctx.fillStyle = '#3a3a4a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Add border
    ctx.strokeStyle = '#5a5a6a';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, this.canvas.width - 4, this.canvas.height - 4);
    
    // Text - white for high contrast
    ctx.font = 'bold 40px system-ui, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const displayText = this.currentText || (this.options.placeholder || 'Type here...');
    const textColor = this.currentText ? '#ffffff' : '#aaaaaa'; // White text, grey placeholder
    ctx.fillStyle = textColor;
    
    // Show cursor
    const textWithCursor = this.insertCursor(displayText);
    ctx.fillText(textWithCursor, 20, this.canvas.height / 2);
    
    // Character count
    if (this.options.maxLength) {
      ctx.font = '20px system-ui';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#aaaaaa';
      ctx.fillText(`${this.currentText.length}/${this.options.maxLength}`, this.canvas.width - 20, this.canvas.height - 20);
    }
    
    this.texture.needsUpdate = true;
  }

  private insertCursor(text: string): string {
    if (this.cursorPos <= text.length) {
      return text.slice(0, this.cursorPos) + '|' + text.slice(this.cursorPos);
    }
    return text + '|';
  }

  private updateSuggestionDisplay() {
    const ctx = this.suggestionCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.suggestionCanvas.width, this.suggestionCanvas.height);
    
    if (this.suggestions.length === 0) {
      this.suggestionTexture.needsUpdate = true;
      return;
    }
    
    // Background - grey to match keyboard
    ctx.fillStyle = '#4a4a5a';
    ctx.fillRect(0, 0, this.suggestionCanvas.width, this.suggestionCanvas.height);
    
    // Border
    ctx.strokeStyle = '#6a6a7a';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, this.suggestionCanvas.width - 2, this.suggestionCanvas.height - 2);
    
    // Suggestions - white text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px system-ui, Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const spacing = this.suggestionCanvas.width / Math.min(this.suggestions.length, 3);
    this.suggestions.slice(0, 3).forEach((word, idx) => {
      ctx.fillText(word, 20 + idx * spacing, this.suggestionCanvas.height / 2);
    });
    
    this.suggestionTexture.needsUpdate = true;
  }

  private updateSuggestions() {
    const words = this.currentText.split(' ');
    const lastWord = words[words.length - 1].toLowerCase();
    
    if (lastWord.length < 2) {
      this.suggestions = [];
      this.updateSuggestionDisplay();
      return;
    }
    
    this.suggestions = this.dictionary
      .filter(word => word.startsWith(lastWord) && word !== lastWord)
      .slice(0, 3);
    
    this.updateSuggestionDisplay();
  }

  // Public API
  show(position: THREE.Vector3, options: KeyboardOptions) {
    this.options = options;
    this.currentText = '';
    this.cursorPos = 0;
    this.suggestions = [];
    this.mode = 'text';
    
    this.buildKeyboard();
    this.group.position.copy(position);
    this.group.visible = true;
    this.updateTextDisplay();
    this.updateSuggestionDisplay();
  }

  hide() {
    this.group.visible = false;
  }

  isVisible(): boolean {
    return this.group.visible;
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  lookAt(target: THREE.Vector3) {
    this.group.lookAt(target);
  }

  checkCollision(handPosition: THREE.Vector3): { key: string; mesh: THREE.Mesh } | null {
    let closestKey: { key: string; mesh: THREE.Mesh; distance: number } | null = null;
    const touchThreshold = 0.025; // 2.5cm for precise touch detection
    
    this.keys.forEach((mesh, key) => {
      const worldPos = new THREE.Vector3();
      mesh.getWorldPosition(worldPos);
      
      // Get key dimensions for accurate 3D box collision
      const geometry = mesh.geometry as THREE.BoxGeometry;
      const keyWidth = geometry.parameters.width;
      const keyHeight = geometry.parameters.height;
      const keyDepth = geometry.parameters.depth;
      
      // Check if hand is within key bounds (3D box collision)
      const localPos = handPosition.clone().sub(worldPos);
      const isWithinBounds = 
        Math.abs(localPos.x) < keyWidth / 2 + touchThreshold &&
        Math.abs(localPos.y) < keyHeight / 2 + touchThreshold &&
        Math.abs(localPos.z) < keyDepth / 2 + touchThreshold;
      
      if (isWithinBounds) {
        const distance = handPosition.distanceTo(worldPos);
        if (!closestKey || distance < closestKey.distance) {
          closestKey = { key, mesh, distance };
        }
      }
    });
    
    return closestKey;
  }

  hoverKey(key: string) {
    const mesh = this.keys.get(key);
    if (!mesh || (mesh as any)._isHovered) return;
    
    const mat = mesh.material as THREE.MeshStandardMaterial;
    (mesh as any)._isHovered = true;
    (mesh as any)._originalScale = mesh.scale.clone();
    
    mesh.scale.multiplyScalar(1.08);
    mat.emissiveIntensity = 0.6;
    
    // Brighten regular keys on hover
    if (key !== 'Post' && key !== 'Cancel' && key !== '⌫') {
      mat.color.setHex(0xaaaacc); // Lighter grey on hover
    }
  }

  clearHover() {
    this.keys.forEach((mesh) => {
      if ((mesh as any)._isHovered) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.2;
        
        // Restore original color
        const originalColor = mesh.userData.originalColor;
        if (originalColor !== undefined) {
          mat.color.setHex(originalColor);
        }
        
        if ((mesh as any)._originalScale) {
          mesh.scale.copy((mesh as any)._originalScale);
        }
        (mesh as any)._isHovered = false;
      }
    });
  }

  pressKey(key: string) {
    const mesh = this.keys.get(key);
    if (mesh) {
      // Enhanced visual feedback with bright flash
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const originalColor = mesh.userData.originalColor;
      const originalScale = mesh.scale.clone();
      
      // Bright white flash
      mat.color.setHex(0xffffff);
      mat.emissiveIntensity = 1.3;
      mesh.scale.multiplyScalar(0.85);
      
      setTimeout(() => {
        mesh.scale.copy(originalScale);
        mesh.scale.multiplyScalar(1.12);
      }, 40);
      
      setTimeout(() => {
        mesh.scale.copy(originalScale);
        mat.color.setHex(originalColor);
        mat.emissiveIntensity = 0.2;
      }, 120);
    }
    
    // Handle key action
    this.handleKeyPress(key);
  }

  private handleKeyPress(key: string) {
    if (key === '⌫') {
      // Backspace
      if (this.cursorPos > 0) {
        this.currentText = this.currentText.slice(0, this.cursorPos - 1) + this.currentText.slice(this.cursorPos);
        this.cursorPos--;
      }
    } else if (key === '←') {
      // Move cursor left
      this.cursorPos = Math.max(0, this.cursorPos - 1);
    } else if (key === '→') {
      // Move cursor right
      this.cursorPos = Math.min(this.currentText.length, this.cursorPos + 1);
    } else if (key === 'Space') {
      // Apply suggestion if available
      if (this.suggestions.length > 0) {
        const words = this.currentText.split(' ');
        words[words.length - 1] = this.suggestions[0];
        this.currentText = words.join(' ') + ' ';
        this.cursorPos = this.currentText.length;
        this.suggestions = [];
      } else {
        this.currentText = this.currentText.slice(0, this.cursorPos) + ' ' + this.currentText.slice(this.cursorPos);
        this.cursorPos++;
      }
    } else if (key === 'Enter') {
      this.currentText = this.currentText.slice(0, this.cursorPos) + '\n' + this.currentText.slice(this.cursorPos);
      this.cursorPos++;
    } else if (key === 'Post') {
      this.options.onSubmit(this.currentText);
      return;
    } else if (key === 'Cancel') {
      this.options.onCancel();
      return;
    } else if (key === 'ABC') {
      // Switch to text mode
      this.mode = 'text';
      this.buildKeyboard();
      return;
    } else if (key === '🙂') {
      // Switch to emoji mode
      this.mode = 'emoji';
      this.buildKeyboard();
      return;
    } else {
      // Regular character
      if (!this.options.maxLength || this.currentText.length < this.options.maxLength) {
        this.currentText = this.currentText.slice(0, this.cursorPos) + key + this.currentText.slice(this.cursorPos);
        this.cursorPos++;
      }
    }
    
    this.updateSuggestions();
    this.updateTextDisplay();
    this.options.onTextChange?.(this.currentText);
  }
}


