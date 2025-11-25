# HoloreelXR - Deployment Guide
## Production Deployment Checklist & Instructions

---

## 🚀 **Quick Start**

### Development

```bash
npm install
npm run dev
```

Open browser to `http://localhost:5173`

### Production Build

```bash
npm run build
npm run preview  # Test production build locally
```

### Deploy to Production

```bash
# Option 1: Vercel (Recommended)
vercel --prod

# Option 2: Netlify
netlify deploy --prod

# Option 3: AWS S3 + CloudFront
npm run build
aws s3 sync dist/ s3://your-bucket-name
```

---

## 📋 **Pre-Deployment Checklist**

### Code Quality

- [ ] All linter errors resolved (`npm run lint`)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] No `console.log` in production code (use `logger` from `production.ts`)
- [ ] All TODOs addressed or documented
- [ ] Code reviewed by senior engineer

### Performance

- [ ] Bundle size < 1MB gzipped
- [ ] Images optimized (compressed, correct format)
- [ ] 3D models optimized (< 10MB each)
- [ ] Lazy loading implemented for large assets
- [ ] CDN configured for static assets

### Security

- [ ] HTTPS enabled (required for WebXR)
- [ ] CORS headers configured correctly
- [ ] No sensitive data in client code
- [ ] Content Security Policy headers set
- [ ] Rate limiting configured (if using API)

### Monitoring

- [ ] Error tracking integrated (Sentry, LogRocket)
- [ ] Analytics configured (Google Analytics, Mixpanel)
- [ ] Performance monitoring enabled
- [ ] Uptime monitoring configured (UptimeRobot, Pingdom)
- [ ] Log aggregation set up (Datadog, Loggly)

### User Experience

- [ ] Loading indicators work
- [ ] Error panels display correctly
- [ ] Tutorial completes successfully
- [ ] All gestures recognized reliably
- [ ] Content loads in < 3 seconds

### Testing

- [ ] Tested on Quest 3
- [ ] Tested on Quest Pro
- [ ] Tested on Quest 2 (performance check)
- [ ] Tested on Vision Pro (if available)
- [ ] Tested on slow network (3G simulation)
- [ ] Tested with poor hand tracking conditions

---

## 🔧 **Environment Configuration**

### Environment Variables

Create `.env.production`:

```bash
# App Info
VITE_APP_VERSION=1.0.0
VITE_APP_NAME=HoloreelXR

# API Endpoints
VITE_API_URL=https://api.holoreelxr.com
VITE_CDN_URL=https://cdn.holoreelxr.com

# Analytics
VITE_GA_ID=G-XXXXXXXXXX
VITE_MIXPANEL_TOKEN=your_token_here

# Error Tracking
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# Feature Flags
VITE_ENABLE_MULTIPLAYER=false
VITE_ENABLE_SPATIAL_AUDIO=false
```

### Production Config

Ensure `src/config/production.ts` is configured:

```typescript
export const ENVIRONMENT = {
  isProduction: true,  // ✅ Set to true for prod
  isDevelopment: false,
  version: '1.0.0',
};
```

---

## 🌐 **Hosting Options**

### Option 1: Vercel (Recommended)

**Pros**: Zero config, automatic HTTPS, edge functions, instant deploys

```bash
npm install -g vercel
vercel login
vercel --prod
```

**Configuration** (`vercel.json`):

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        },
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        }
      ]
    }
  ]
}
```

### Option 2: Netlify

**Pros**: Great for static sites, form handling, serverless functions

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

**Configuration** (`netlify.toml`):

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Opener-Policy = "same-origin"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
```

### Option 3: AWS S3 + CloudFront

**Pros**: Full control, scalable, cost-effective at scale

```bash
# Build
npm run build

# Upload to S3
aws s3 sync dist/ s3://holoreelxr-prod --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

**CloudFront Configuration**:
- Origin: S3 bucket
- Viewer Protocol Policy: Redirect HTTP to HTTPS
- Compress Objects: Yes
- Price Class: Use All Edge Locations

---

## 📦 **CDN Configuration**

### Asset Hosting

**Recommended**: Cloudflare R2 or AWS S3 for 3D models

```bash
# Upload models to CDN
aws s3 sync public/assets/ s3://holoreelxr-assets/ \
  --cache-control "public, max-age=31536000, immutable"
```

### Cache Headers

```nginx
# Nginx configuration
location ~* \.(glb|gltf|ply)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}

location ~* \.(json)$ {
  expires 1h;
  add_header Cache-Control "public, must-revalidate";
}
```

---

## 🔍 **Monitoring Setup**

### Sentry Integration

1. Create Sentry project
2. Install SDK:
   ```bash
   npm install @sentry/browser
   ```
3. Initialize in `main.ts`:
   ```typescript
   import * as Sentry from '@sentry/browser';
   
   if (ENVIRONMENT.isProduction) {
     Sentry.init({
       dsn: import.meta.env.VITE_SENTRY_DSN,
       environment: 'production',
       tracesSampleRate: 0.1,
     });
   }
   ```

### Google Analytics

```typescript
// Add to index.html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### Performance Monitoring

```typescript
// In ThreeXRApp.ts
private trackPerformance() {
  const fps = this.renderer.info.render.frame / 
    (performance.now() / 1000);
  
  analytics.trackEvent('performance', {
    fps: Math.round(fps),
    memory: performance.memory?.usedJSHeapSize,
    drawCalls: this.renderer.info.render.calls,
  });
}
```

---

## 🚨 **Rollback Plan**

### Version Control

```bash
# Tag each release
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# Rollback if needed
git revert HEAD
git push origin main
```

### Vercel Rollback

```bash
vercel rollback
```

### CloudFront Rollback

1. Upload previous version to S3
2. Invalidate cache
3. Monitor error rates

---

## 📊 **Post-Deployment Validation**

### Automated Checks

```bash
# Health check
curl https://holoreelxr.com/feed.json

# Performance test
lighthouse https://holoreelxr.com --view

# Security scan
npm audit
```

### Manual Checks

- [ ] Open app on Quest 3
- [ ] Complete tutorial
- [ ] Scroll through feed (10+ items)
- [ ] Test all gestures
- [ ] Check error handling (disconnect network)
- [ ] Verify analytics tracking
- [ ] Check Sentry for errors

---

## 🐛 **Debugging Production Issues**

### Enable Debug Mode (Temporarily)

```typescript
// In production.ts
export const PRODUCTION_CONFIG = {
  ENABLE_DEBUG_LOGS: true,  // Temporary
  // ...
};
```

**⚠️ Remember to disable after debugging!**

### Common Issues

**Issue**: Models not loading
- Check CORS headers
- Verify CDN URLs
- Check network tab in DevTools

**Issue**: Poor performance
- Check `renderer.info.render.calls` (should be < 200)
- Profile with Chrome DevTools
- Reduce model complexity

**Issue**: Gestures not working
- Check hand tracking permissions
- Verify XR session active
- Check for console errors

---

## 📈 **Performance Targets**

### Production Benchmarks

| Metric | Target | Monitoring |
|--------|--------|------------|
| **Time to Interactive** | < 2s | Lighthouse |
| **First Contentful Paint** | < 1s | Lighthouse |
| **Bundle Size (gzipped)** | < 500KB | Bundlephobia |
| **Frame Rate (Quest 3)** | 72 FPS | WebXR metrics |
| **Memory Usage** | < 300MB | Chrome DevTools |
| **API Response Time** | < 200ms | New Relic |

---

## 🔐 **Security Hardening**

### HTTP Headers

```nginx
# Security headers
add_header X-Frame-Options "DENY";
add_header X-Content-Type-Options "nosniff";
add_header X-XSS-Protection "1; mode=block";
add_header Referrer-Policy "strict-origin-when-cross-origin";
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()";
```

### Content Security Policy

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.holoreelxr.com https://cdn.holoreelxr.com;
  font-src 'self';
">
```

---

## 📱 **Mobile Companion App**

### Progressive Web App (PWA)

Add `manifest.json`:

```json
{
  "name": "HoloreelXR",
  "short_name": "HoloreelXR",
  "description": "Social 3D content in XR",
  "theme_color": "#4ECDC4",
  "background_color": "#000000",
  "display": "standalone",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

---

## 🎉 **Launch Day Checklist**

### 24 Hours Before

- [ ] Final code freeze
- [ ] Run full test suite
- [ ] Deploy to staging
- [ ] Load test (simulate 1000 concurrent users)
- [ ] Verify monitoring dashboards
- [ ] Prepare rollback plan

### Launch Day

- [ ] Deploy to production (morning, not Friday!)
- [ ] Monitor error rates (first 30 minutes)
- [ ] Check analytics tracking
- [ ] Test on multiple devices
- [ ] Monitor server load
- [ ] Announce on social media

### First Week

- [ ] Daily error rate review
- [ ] User feedback collection
- [ ] Performance monitoring
- [ ] Hotfix any critical issues
- [ ] Celebrate 🎉

---

## 📞 **Support Contacts**

**DevOps Lead**: [devops@holoreelxr.com]
**On-Call Engineer**: [oncall@holoreelxr.com]
**Status Page**: [status.holoreelxr.com]

---

*This guide is maintained by the engineering team. Last updated: November 2025.*

**Remember**: Smooth deployments come from thorough preparation. Take your time, follow the checklist, and you'll be fine! 🚀

