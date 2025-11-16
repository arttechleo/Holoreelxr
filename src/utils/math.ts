/**
 * Math utilities for 3D calculations and transformations
 */

import * as THREE from 'three';

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Smooth damp (Unity-style) for smooth following
 */
export function smoothDamp(
  current: number,
  target: number,
  currentVelocity: { value: number },
  smoothTime: number,
  maxSpeed: number,
  deltaTime: number
): number {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * deltaTime;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  
  let change = current - target;
  const originalTo = target;
  const maxChange = maxSpeed * smoothTime;
  
  change = clamp(change, -maxChange, maxChange);
  target = current - change;
  
  const temp = (currentVelocity.value + omega * change) * deltaTime;
  currentVelocity.value = (currentVelocity.value - omega * temp) * exp;
  
  let output = target + (change + temp) * exp;
  
  if (originalTo - current > 0.0 === output > originalTo) {
    output = originalTo;
    currentVelocity.value = (output - originalTo) / deltaTime;
  }
  
  return output;
}

/**
 * Normalize angle to [-PI, PI] range
 */
export function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= 2 * Math.PI;
  while (result < -Math.PI) result += 2 * Math.PI;
  return result;
}

/**
 * Calculate shortest angle delta between two angles
 */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Low-pass filter for smoothing noisy values
 */
export class LowPassFilter {
  private value: number;
  
  constructor(initialValue: number = 0) {
    this.value = initialValue;
  }
  
  update(newValue: number, alpha: number): number {
    this.value = this.value + (newValue - this.value) * alpha;
    return this.value;
  }
  
  get current(): number {
    return this.value;
  }
  
  reset(value: number = 0): void {
    this.value = value;
  }
}

/**
 * Moving average filter
 */
export class MovingAverage {
  private buffer: number[] = [];
  
  constructor(private windowSize: number) {}
  
  add(value: number): number {
    this.buffer.push(value);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    return this.average;
  }
  
  get average(): number {
    if (this.buffer.length === 0) return 0;
    return this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
  }
  
  reset(): void {
    this.buffer = [];
  }
}

/**
 * Calculate distance from point to line segment
 */
export function distanceToLineSegment(
  point: THREE.Vector3,
  lineStart: THREE.Vector3,
  lineEnd: THREE.Vector3
): number {
  const line = new THREE.Vector3().subVectors(lineEnd, lineStart);
  const lineLength = line.length();
  
  if (lineLength === 0) {
    return point.distanceTo(lineStart);
  }
  
  line.normalize();
  
  const pointToStart = new THREE.Vector3().subVectors(point, lineStart);
  const t = clamp(pointToStart.dot(line), 0, lineLength);
  
  const closestPoint = lineStart.clone().add(line.multiplyScalar(t));
  return point.distanceTo(closestPoint);
}

/**
 * Check if point is inside a sphere
 */
export function isInsideSphere(
  point: THREE.Vector3,
  sphereCenter: THREE.Vector3,
  sphereRadius: number
): boolean {
  return point.distanceTo(sphereCenter) <= sphereRadius;
}

/**
 * Check if point is inside an axis-aligned bounding box
 */
export function isInsideAABB(
  point: THREE.Vector3,
  boxMin: THREE.Vector3,
  boxMax: THREE.Vector3
): boolean {
  return (
    point.x >= boxMin.x && point.x <= boxMax.x &&
    point.y >= boxMin.y && point.y <= boxMax.y &&
    point.z >= boxMin.z && point.z <= boxMax.z
  );
}

/**
 * Degrees to radians
 */
export function deg2rad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Radians to degrees
 */
export function rad2deg(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Exponential decay function
 */
export function exponentialDecay(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

