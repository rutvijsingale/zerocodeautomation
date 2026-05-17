import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// CORS configuration
export const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      // Add your production domains here
      process.env.ALLOWED_ORIGINS?.split(',') || []
    ].flat();

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Permissive CORS for recording endpoints (allows any origin for browser injection)
// This is needed because recording happens on external websites (amazon.com, etc.)
export const recordingCorsOptions = {
  origin: true, // Allow all origins for recording endpoints
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Rate limiting
export const createRateLimiter = (windowMs = 15 * 60 * 1000, max = 100) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Strict rate limiting for sensitive endpoints
export const strictRateLimiter = createRateLimiter(5 * 60 * 1000, 10); // 10 requests per 5 minutes

// General rate limiting
export const generalRateLimiter = createRateLimiter(15 * 60 * 1000, 100); // 100 requests per 15 minutes

// [ZAC-FIX] Lenient rate limiting for polling endpoints. The dashboard
// has multiple ~4s pollers running in parallel (framework projection,
// runs history, framework-summary, dashboard/live, etc.) PLUS the Settings
// iframe and the Recording tab boot calls — easily 30-60 polls/min on
// a single user. Original 60/min was too tight, often surfaced as
// "HTTP 429" on /api/frameworks when navigating tabs after smoke testing.
// Bumped to 600/min (10/sec sustained) which is still cheap for a
// localhost-only IDE but absorbs the worst-case observed traffic.
export const pollingRateLimiter = createRateLimiter(60 * 1000, 600);

// Security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding for WebSocket connections
});

// Input sanitization
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

// Validate project name
export const validateProjectName = (name) => {
  if (!name || typeof name !== 'string') {
    throw new Error('Project name is required and must be a string');
  }

  const sanitized = name.replace(/[^\w\-]/g, '-');
  if (sanitized.length === 0) {
    throw new Error('Project name must contain at least one alphanumeric character');
  }

  if (sanitized.length > 100) {
    throw new Error('Project name must be less than 100 characters');
  }

  return sanitized;
};

// Validate session ID
export const validateSessionId = (sessionId) => {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Session ID is required');
  }

  // Basic UUID format validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(sessionId)) {
    throw new Error('Invalid session ID format');
  }

  return sessionId;
};

// Request validation middleware
export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details.map(detail => detail.message)
        });
      }
      req.body = value;
      next();
    } catch (err) {
      next(err);
    }
  };
};
