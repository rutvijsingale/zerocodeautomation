# Zero-Code Automation IDE

A powerful web-based IDE for recording and generating automated test scripts without writing code. Supports multiple testing frameworks including Playwright, Cucumber, and Selenium.

## Features

- 🎬 **Browser Recording**: Record user interactions in real-time
- 🔄 **Multi-Framework Support**: Generate code for Playwright, Cucumber, Selenium
- 🌐 **WebSocket Integration**: Real-time action streaming
- 🔒 **Security First**: CORS, rate limiting, input validation
- 📁 **Project Management**: Organize and export test projects
- 🚀 **Performance Optimized**: Async operations, session management
- 🛡️ **Error Handling**: Comprehensive error handling and logging

## Quick Start

### Prerequisites

- Node.js 18+
- Chrome/Chromium browser installed
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd zero-code-automation-ide
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment configuration:
```bash
cp .env.example .env
```

4. Start the server:
```bash
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### Health & Configuration
- `GET /api/health` - Health check
- `GET /api/config` - Server configuration

### Recording Sessions
- `POST /api/recording/start` - Start a new recording session
- `POST /api/recording/stop` - Stop recording and get captured actions
- `GET /api/recording/:sessionId/status` - Get session status
- `GET /api/recording/:sessionId/actions` - Get captured actions

### Project Management
- `GET /api/projects` - List all projects
- `DELETE /api/projects/:projectName` - Delete a project

### Export & Generation
- `POST /api/export` - Export project as ZIP
- `POST /api/validate` - Validate feature steps

### WebSocket
- `WS /api/recording/:sessionId` - Real-time action streaming

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins |
| `MAX_SESSIONS` | `5` | Maximum concurrent sessions |
| `SESSION_TIMEOUT` | `1800000` | Session timeout in ms |
| `EXPORT_DIR` | `sample-export` | Export directory |

## Development

### Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with auto-reload
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code

### Project Structure

```
zero-code-automation-ide/
├── middleware/           # Express middleware
│   ├── security.js      # Security, CORS, validation
│   └── errorHandler.js  # Error handling utilities
├── services/            # Business logic services
│   ├── browserService.js # Browser automation
│   └── fileService.js   # File operations
├── routes/              # API route handlers
│   ├── api.js          # REST API endpoints
│   └── websocket.js    # WebSocket handlers
├── generators/          # Code generation modules
├── server.js           # Main server file
├── package.json        # Dependencies and scripts
└── .env.example       # Environment configuration
```

## Security

The application implements several security measures:

- **CORS Protection**: Configurable allowed origins
- **Rate Limiting**: Prevents abuse with configurable limits
- **Input Validation**: Sanitizes and validates all inputs
- **Helmet Security Headers**: Sets secure HTTP headers
- **Session Management**: Automatic cleanup of inactive sessions

## Browser Support

- Chrome/Chromium (recommended)
- Firefox (limited support)
- Safari (limited support)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please create an issue in the repository or contact the development team.
