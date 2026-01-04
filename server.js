import express from 'express';
import expressWs from 'express-ws';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Import middleware and services
import { corsOptions, recordingCorsOptions, securityHeaders, generalRateLimiter } from './middleware/security.js';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/errorHandler.js';
import { browserService } from './services/browserService.js';
import { FileService } from './services/fileService.js';

// Import routes
import apiRoutes from './routes/api.js';
import requirementsRoutes from './routes/requirements.js';
import { handleWebSocketConnection, handleActionCapture } from './routes/websocket.js';

// Initialize services
const fileService = new FileService();

// Create Express app with WebSocket support
const app = express();
const wsInstance = expressWs(app);

// Middleware setup
app.use(helmet(securityHeaders));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// IMPORTANT: Recording action endpoint must be defined BEFORE global CORS
// This allows external websites (amazon.com, etc.) to send actions
app.options('/api/recording/:sessionId/action', cors(recordingCorsOptions));
app.post('/api/recording/:sessionId/action', cors(recordingCorsOptions), (req, res, next) => {
  console.log(`[Action Route] POST /api/recording/${req.params.sessionId}/action - Matched`);
  handleActionCapture(req, res).catch(next);
});

// CORS: Apply restrictive CORS by default for other endpoints
app.use(cors(corsOptions));

// Note: Rate limiting is applied per-route, not globally
// This allows critical operations like stopping recording to always work

// Serve documentation files (must be BEFORE static middleware)
// Use async handler to properly handle errors
app.get('/USER_MANUAL.md', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'USER_MANUAL.md');
    console.log(`[Docs] 📖 Request for USER_MANUAL.md from: ${req.ip}`);
    console.log(`[Docs] 📄 File path: ${filePath}`);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Docs] ❌ Error serving USER_MANUAL.md:`, err);
        res.status(404).json({ error: 'User Manual not found', path: filePath, message: err.message });
      } else {
        console.log(`[Docs] ✅ Successfully served USER_MANUAL.md`);
      }
    });
  } catch (error) {
    console.error(`[Docs] ❌ Error in USER_MANUAL.md route:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/QUICK_START_GUIDE.md', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'QUICK_START_GUIDE.md');
    console.log(`[Docs] 🚀 Request for QUICK_START_GUIDE.md from: ${req.ip}`);
    console.log(`[Docs] 📄 File path: ${filePath}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Docs] ❌ Error serving QUICK_START_GUIDE.md:`, err);
        res.status(404).json({ error: 'Quick Start Guide not found', path: filePath, message: err.message });
      } else {
        console.log(`[Docs] ✅ Successfully served QUICK_START_GUIDE.md`);
      }
    });
  } catch (error) {
    console.error(`[Docs] ❌ Error in QUICK_START_GUIDE.md route:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/TEST_CASE_DESIGN_GUIDE.md', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'TEST_CASE_DESIGN_GUIDE.md');
    console.log(`[Docs] 📋 Request for TEST_CASE_DESIGN_GUIDE.md from: ${req.ip}`);
    console.log(`[Docs] 📄 File path: ${filePath}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Docs] ❌ Error serving TEST_CASE_DESIGN_GUIDE.md:`, err);
        res.status(404).json({ error: 'Test Case Design Guide not found', path: filePath, message: err.message });
      } else {
        console.log(`[Docs] ✅ Successfully served TEST_CASE_DESIGN_GUIDE.md`);
      }
    });
  } catch (error) {
    console.error(`[Docs] ❌ Error in TEST_CASE_DESIGN_GUIDE.md route:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

app.get('/AUTOMATION_ENGINEER_GUIDE.md', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'AUTOMATION_ENGINEER_GUIDE.md');
    console.log(`[Docs] 🔧 Request for AUTOMATION_ENGINEER_GUIDE.md from: ${req.ip}`);
    console.log(`[Docs] 📄 File path: ${filePath}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Docs] ❌ Error serving AUTOMATION_ENGINEER_GUIDE.md:`, err);
        res.status(404).json({ error: 'Automation Engineer Guide not found', path: filePath, message: err.message });
      } else {
        console.log(`[Docs] ✅ Successfully served AUTOMATION_ENGINEER_GUIDE.md`);
      }
    });
  } catch (error) {
    console.error(`[Docs] ❌ Error in AUTOMATION_ENGINEER_GUIDE.md route:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Also serve SCENARIO_OUTLINE_GUIDE.md
app.get('/SCENARIO_OUTLINE_GUIDE.md', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'SCENARIO_OUTLINE_GUIDE.md');
    console.log(`[Docs] 📘 Request for SCENARIO_OUTLINE_GUIDE.md from: ${req.ip}`);
    console.log(`[Docs] 📄 File path: ${filePath}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error(`[Docs] ❌ Error serving SCENARIO_OUTLINE_GUIDE.md:`, err);
        res.status(404).json({ error: 'Scenario Outline Guide not found', path: filePath, message: err.message });
      } else {
        console.log(`[Docs] ✅ Successfully served SCENARIO_OUTLINE_GUIDE.md`);
      }
    });
  } catch (error) {
    console.error(`[Docs] ❌ Error in SCENARIO_OUTLINE_GUIDE.md route:`, error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Static file serving for public directory (frontend)
app.use(express.static('public'));

// Routes
app.use('/api', apiRoutes);
app.use('/api/requirements', requirementsRoutes);

// Log all registered routes for debugging
console.log('[Server] API routes mounted at /api');
console.log('[Server] Requirements routes mounted at /api/requirements');

// WebSocket routes
app.ws('/api/recording/:sessionId', handleWebSocketConnection);

// Static file serving for generated projects
app.use('/exports', express.static(fileService.baseDir));

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down gracefully...`);

  // Close all active browser sessions
  const activeSessions = Array.from(browserService.activeSessions.keys());
  for (const sessionId of activeSessions) {
    try {
      await browserService.destroySession(sessionId);
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
  }

  // Cleanup old projects
  try {
    await fileService.cleanupOldProjects();
  } catch (error) {
    console.error('Error during cleanup:', error);
  }

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Periodic cleanup
setInterval(async () => {
  try {
    await fileService.cleanupOldProjects();
  } catch (error) {
    console.error('Error during periodic cleanup:', error);
  }
}, 24 * 60 * 60 * 1000); // Daily cleanup

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Zero-Code Automation IDE Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 API endpoints: http://localhost:${PORT}/api/*`);
  console.log(`🌐 WebSocket: ws://localhost:${PORT}/api/recording/{sessionId}`);
  console.log(`📁 Exports: http://localhost:${PORT}/exports/`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});

export default app;
