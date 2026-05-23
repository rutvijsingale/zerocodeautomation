import { sanitizeInput } from './security.js';

// Standard error response format
export const createErrorResponse = (error, statusCode = 500, includeStack = false) => {
  const response = {
    success: false,
    error: sanitizeInput(error.message) || 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    requestId: generateRequestId()
  };

  if (includeStack && error.stack) {
    response.stack = error.stack;
  }

  return { response, statusCode };
};

// Generate unique request ID for tracking
const generateRequestId = () => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Async error wrapper
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Global error handler middleware
export const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Handle specific error types
  if (err.name === 'ValidationError') {
    const { response, statusCode } = createErrorResponse(err, 400);
    return res.status(statusCode).json(response);
  }

  if (err.name === 'UnauthorizedError') {
    const { response, statusCode } = createErrorResponse(err, 401);
    return res.status(statusCode).json(response);
  }

  if (err.name === 'ForbiddenError') {
    const { response, statusCode } = createErrorResponse(err, 403);
    return res.status(statusCode).json(response);
  }

  if (err.name === 'NotFoundError') {
    const { response, statusCode } = createErrorResponse(err, 404);
    return res.status(statusCode).json(response);
  }

  if (err.code === 'EBUSY' || err.code === 'EMFILE') {
    const { response, statusCode } = createErrorResponse(
      new Error('Server is busy, please try again later'),
      503
    );
    return res.status(statusCode).json(response);
  }

  // [ZAC-FIX] Express body-parser raises distinct errors for malformed
  // JSON, oversized payloads, and unsupported content-types. Without this
  // branch they fall through to the generic 500 path, which reads as a
  // server bug to the client even though the input was at fault.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError && /JSON/.test(err.message)) {
    const { response, statusCode } = createErrorResponse(
      new Error('Malformed JSON body: ' + (err.message || 'parse error')),
      400
    );
    return res.status(statusCode).json(response);
  }
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    const { response, statusCode } = createErrorResponse(
      new Error('Request body too large (limit ' + (err.limit ? Math.round(err.limit / 1024) + ' KB' : '10 MB') + ')'),
      413
    );
    return res.status(statusCode).json(response);
  }
  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported' || err.type === 'parameters.too.many') {
    const { response, statusCode } = createErrorResponse(err, 400);
    return res.status(statusCode).json(response);
  }

  // Default error response
  const { response, statusCode } = createErrorResponse(err, 500, process.env.NODE_ENV === 'development');
  res.status(statusCode).json(response);
};

// 404 handler
export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.name = 'NotFoundError';
  next(error);
};

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = generateRequestId();

  // Add request ID to request object
  req.requestId = requestId;

  console.log(`[${requestId}] ${req.method} ${req.url} - Start`);

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 400 ? 'error' : 'info';

    console[level](`[${requestId}] ${req.method} ${req.url} - ${status} - ${duration}ms`);
  });

  next();
};

// Health check endpoint response
export const createHealthResponse = (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  });
};
