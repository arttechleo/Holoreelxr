/**
 * Custom error classes and error handling utilities
 */

export class WebXRError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'WebXRError';
  }
}

export class AssetLoadError extends Error {
  constructor(
    message: string,
    public url?: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'AssetLoadError';
  }
}

export class GestureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GestureError';
  }
}

/**
 * Safely logs errors without throwing
 */
export function logError(error: unknown, context?: string): void {
  const prefix = context ? `[${context}]` : '';
  
  if (error instanceof Error) {
    console.error(`${prefix} ${error.name}: ${error.message}`, error);
  } else {
    console.error(`${prefix} Unknown error:`, error);
  }
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        throw error;
      }

      onRetry?.(attempt, error);
      
      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Wraps an async function with try-catch and error logging
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context: string
): (...args: T) => Promise<R | null> {
  return async (...args: T): Promise<R | null> => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error, context);
      return null;
    }
  };
}

/**
 * Check if WebXR is supported
 */
export async function checkWebXRSupport(): Promise<{
  supported: boolean;
  ar: boolean;
  vr: boolean;
  handTracking: boolean;
}> {
  const result = {
    supported: false,
    ar: false,
    vr: false,
    handTracking: false,
  };

  try {
    // Check if WebXR is available
    if (typeof navigator === 'undefined' || !(navigator as any).xr) {
      return result;
    }

    const xr = (navigator as any).xr as XRSystem | undefined;
    
    if (!xr || typeof xr.isSessionSupported !== 'function') {
      return result;
    }

    result.supported = true;

    // Check AR support
    try {
      result.ar = await xr.isSessionSupported('immersive-ar');
    } catch (e) {
      result.ar = false;
      // Silently fail - not all browsers support AR
    }

    // Check VR support
    try {
      result.vr = await xr.isSessionSupported('immersive-vr');
    } catch (e) {
      result.vr = false;
      // Silently fail - not all browsers support VR
    }

    // Hand tracking detection is session-dependent, can't pre-check reliably
    result.handTracking = false;

  } catch (error) {
    // Don't log errors for unsupported browsers - this is expected
    // Only log unexpected errors
    if (error instanceof Error && !error.message.includes('not supported')) {
      logError(error, 'WebXR Support Check');
    }
  }

  return result;
}

