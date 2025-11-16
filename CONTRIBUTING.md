# Contributing to Holoreelxr

Thank you for your interest in contributing! This document provides guidelines and instructions.

## 🚀 Getting Started

1. **Fork the repository** and clone your fork
2. **Install dependencies**: `npm install`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make your changes**
5. **Test thoroughly** on WebXR devices if possible
6. **Submit a pull request**

## 📋 Development Guidelines

### Code Style

- **TypeScript**: Use strict type checking, avoid `any` when possible
- **Naming conventions**:
  - Classes: `PascalCase`
  - Functions/methods: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`
  - Private members: prefix with `_` or use `private` keyword

- **Comments**: Use JSDoc for public APIs
```typescript
/**
 * Detects pinch gesture between thumb and index finger.
 * @param side - Which hand to check ('left' or 'right')
 * @returns True if pinching, false otherwise
 */
isPinching(side: Side): boolean { ... }
```

### File Organization

- One class per file (with related types/interfaces in same file)
- Group related functionality in directories
- Keep files under 1000 lines (split into smaller modules if needed)

### Performance Considerations

- **Frame budget**: Aim for 90fps (11ms per frame) on Quest 2
- **Memory**: Dispose of Three.js geometries/materials when done
- **Gesture smoothing**: Use low-pass filters to avoid jitter

### Testing

Currently no automated tests - manual testing required:

1. **Desktop browser** with WebXR Emulator extension
2. **Meta Quest** (2/3/Pro) via browser
3. **AR-capable devices** (if available)

Test checklist:
- [ ] All gestures work correctly
- [ ] Feed scrolling is smooth
- [ ] UI panels are readable and clickable
- [ ] No console errors
- [ ] Frame rate stays above 72fps

## 🐛 Reporting Bugs

When filing an issue, please include:

- **Device**: Browser and WebXR device (Quest 2, HoloLens, etc.)
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Screenshots/video** if applicable
- **Console errors**

## 💡 Feature Requests

We welcome feature ideas! Please describe:

- **Use case**: What problem does it solve?
- **Proposed solution**: How should it work?
- **Alternatives**: Other approaches you considered
- **Impact**: Who benefits from this feature?

## 🎨 Design Principles

1. **Gesture-first**: Prioritize natural hand interactions over button presses
2. **Fail gracefully**: Degrade to simpler controls if hand tracking unavailable
3. **Visual feedback**: Always show feedback for user actions
4. **Performance**: 90fps+ is non-negotiable for comfortable VR
5. **Accessibility**: Consider users with different physical abilities

## 📦 Pull Request Process

1. **Update documentation** if you change APIs or add features
2. **Keep PRs focused**: One feature/fix per PR
3. **Write clear commit messages**:
   ```
   feat: add swipe gesture for quick reactions
   fix: prevent double-trigger on heart gesture
   refactor: extract gesture detection to separate functions
   docs: update README with new gesture controls
   ```
4. **Link related issues**: Reference issue numbers in PR description
5. **Be responsive**: Address review feedback promptly

## 🏗️ Architecture Notes

### Key Classes

- **ThreeXRApp**: Manages WebGL renderer, XR session, animation loop
- **HandEngine**: Raw hand tracking data → recognized gestures (events)
- **FeedControls**: Gesture events → application actions (like, scroll, grab)
- **FeedStore**: Content state management, transforms, reactions
- **ReactionHud**: 3D floating UI panel with raycasting

### Data Flow

```
XRFrame → HandEngine → gesture events → FeedControls → FeedStore → Three.js scene
                                              ↓
                                      ReactionHudManager → ReactionHud
```

### Adding Content Types

1. Add type definition in `FeedStore.ts`
2. Implement loading logic in `showCurrent()`
3. Update `feed.json` schema in README

## 🎯 Priority Areas

We'd especially appreciate contributions in:

- [ ] **Gesture library expansion** (more social gestures)
- [ ] **3D model loaders** (GLTF, FBX support)
- [ ] **Network integration** (fetch real feeds from API)
- [ ] **Voice commands** (Web Speech API integration)
- [ ] **Accessibility** (keyboard controls, screen reader support)
- [ ] **Testing framework** (automated WebXR testing)

## 📞 Questions?

Feel free to open a discussion issue for questions about architecture, design decisions, or implementation details.

---

Happy coding! 🚀

