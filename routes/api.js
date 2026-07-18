// routes/api.js — thin index (split from 6591-line monolith on 2026-07-19)
// Each domain now lives in its own file. This file only mounts them.
//
// server.js does: import apiRoutes from './routes/api.js'; app.use('/api', apiRoutes);
// That contract is preserved — this still default-exports a single Express router.

import express from 'express';
import healthRouter from './health.js';
import recordingRouter from './recording.js';
import codegenRouter from './codegen.js';
import rerunRouter from './rerun.js';
import projectsRouter from './projects.js';
import locatorsRouter from './locators.js';
import environmentsRouter from './environments.js';
import runnersRouter from './runners.js';
import aiRouter from './ai.js';
import dashboardRouter from './dashboard.js';

// Re-export __testables so that any code importing from routes/api.js keeps working.
export { __testables } from './shared.js';

const router = express.Router();

router.use('/', healthRouter);
router.use('/', recordingRouter);
router.use('/', codegenRouter);
router.use('/', rerunRouter);
router.use('/', projectsRouter);
router.use('/', locatorsRouter);
router.use('/', environmentsRouter);
router.use('/', runnersRouter);
router.use('/', aiRouter);
router.use('/', dashboardRouter);

export default router;
