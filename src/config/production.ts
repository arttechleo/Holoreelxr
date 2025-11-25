/**
 * Production configuration and environment detection
 * Controls debug logging, analytics, and feature flags
 */

export const ENVIRONMENT = {
  isProduction: import.meta.env.PROD || false,
  isDevelopment: import.meta.env.DEV || false,
  version: import.meta.env.VITE_APP_VERSION || '1.0.0',
} as const;

export const PRODUCTION_CONFIG = {
  /**
   * Enable debug logging (console.log, console.warn)
   * Auto-disabled in production builds
   */
  ENABLE_DEBUG_LOGS: !ENVIRONMENT.isProduction,
  
  /**
   * Enable verbose logging for troubleshooting
   * Only for development
   */
  ENABLE_VERBOSE_LOGS: ENVIRONMENT.isDevelopment,
  
  /**
   * Enable error tracking and analytics
   * Should be enabled in production
   */
  ENABLE_ANALYTICS: ENVIRONMENT.isProduction,
  
  /**
   * Enable performance monitoring
   * Useful for both dev and prod
   */
  ENABLE_PERFORMANCE_MONITORING: true,
  
  /**
   * Show FPS counter in XR
   * Only in development
   */
  SHOW_FPS_COUNTER: ENVIRONMENT.isDevelopment,
  
  /**
   * Enable visual debug helpers (rays, etc.)
   * Only in development
   */
  SHOW_DEBUG_HELPERS: ENVIRONMENT.isDevelopment,
  
  /**
   * Maximum retry attempts for network requests
   */
  MAX_RETRY_ATTEMPTS: ENVIRONMENT.isProduction ? 3 : 2,
  
  /**
   * Request timeout (ms)
   */
  REQUEST_TIMEOUT_MS: ENVIRONMENT.isProduction ? 30000 : 15000,
  
  /**
   * Enable experimental features
   * Only in development
   */
  ENABLE_EXPERIMENTAL_FEATURES: ENVIRONMENT.isDevelopment,
} as const;

/**
 * Conditional logging that respects production config
 */
export const logger = {
  log: (...args: any[]) => {
    if (PRODUCTION_CONFIG.ENABLE_DEBUG_LOGS) {
      console.log(...args);
    }
  },
  
  warn: (...args: any[]) => {
    if (PRODUCTION_CONFIG.ENABLE_DEBUG_LOGS) {
      console.warn(...args);
    }
  },
  
  error: (...args: any[]) => {
    // Always log errors, even in production
    console.error(...args);
    
    // Send to error tracking service in production
    if (PRODUCTION_CONFIG.ENABLE_ANALYTICS) {
      // TODO: Integrate with error tracking service (Sentry, LogRocket, etc.)
      // trackError(args);
    }
  },
  
  verbose: (...args: any[]) => {
    if (PRODUCTION_CONFIG.ENABLE_VERBOSE_LOGS) {
      console.log('[VERBOSE]', ...args);
    }
  },
  
  performance: (label: string, value: number) => {
    if (PRODUCTION_CONFIG.ENABLE_PERFORMANCE_MONITORING) {
      console.log(`[PERFORMANCE] ${label}: ${value.toFixed(2)}ms`);
      
      // Send to analytics in production
      if (PRODUCTION_CONFIG.ENABLE_ANALYTICS) {
        // TODO: Track performance metrics
        // trackPerformance(label, value);
      }
    }
  },
};

/**
 * Analytics tracking wrapper
 * Placeholder for future analytics integration
 */
export const analytics = {
  trackEvent: (event: string, properties?: Record<string, any>) => {
    if (!PRODUCTION_CONFIG.ENABLE_ANALYTICS) {
      logger.verbose('[Analytics]', event, properties);
      return;
    }
    
    // TODO: Integrate with analytics service (Google Analytics, Mixpanel, etc.)
    // Example: gtag('event', event, properties);
    logger.verbose('[Analytics] Event:', event, properties);
  },
  
  trackError: (error: Error, context?: string) => {
    if (!PRODUCTION_CONFIG.ENABLE_ANALYTICS) {
      logger.error('[Error Tracking]', context, error);
      return;
    }
    
    // TODO: Integrate with error tracking (Sentry, Rollbar, etc.)
    // Example: Sentry.captureException(error, { tags: { context } });
    logger.error('[Error Tracking]', context, error);
  },
  
  trackPageView: (page: string) => {
    if (!PRODUCTION_CONFIG.ENABLE_ANALYTICS) {
      logger.verbose('[Analytics] Page view:', page);
      return;
    }
    
    // TODO: Track page views
    logger.verbose('[Analytics] Page view:', page);
  },
  
  setUserProperties: (properties: Record<string, any>) => {
    if (!PRODUCTION_CONFIG.ENABLE_ANALYTICS) {
      logger.verbose('[Analytics] User properties:', properties);
      return;
    }
    
    // TODO: Set user properties
    logger.verbose('[Analytics] User properties:', properties);
  },
};

/**
 * Feature flags for gradual rollout
 */
export const FEATURE_FLAGS = {
  /**
   * Enable new hand tracking algorithm
   */
  NEW_HAND_TRACKING: true,
  
  /**
   * Enable spatial audio
   */
  SPATIAL_AUDIO: false,
  
  /**
   * Enable multiplayer features
   */
  MULTIPLAYER: false,
  
  /**
   * Enable AI-powered content recommendations
   */
  AI_RECOMMENDATIONS: false,
} as const;

export default {
  ENVIRONMENT,
  PRODUCTION_CONFIG,
  logger,
  analytics,
  FEATURE_FLAGS,
};

