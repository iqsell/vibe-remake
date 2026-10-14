import { logger } from '../observability/logger.js';
import { connectDatabase, healthCheckDatabase } from '../db/client.js';
import { setupShutdownHandlers, registerShutdownCleanup } from './shutdown.js';
import { createContainer } from './container.js';
import { getEnv, validateProviderKeys } from '../config/env.js';
import { createDiscordClient } from '../discord/client.js';
import { initializeAI } from '../ai/index.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerAllTools } from '../tools/index.js';
import { PolicyEngine } from '../policy/authorize.js';
import { initializeRequestHandler } from '../agent/request-handler.js';
import { registerApplicationInteractions } from '../discord/interactions/applications.js';
import { startJobScheduler, stopJobScheduler } from '../jobs/scheduler.js';

async function bootstrap(): Promise<void> {
  const startTime = Date.now();

  logger.info({ target: 'bootstrap' }, 'Starting Vibe Discord Bot...');

  // Load and validate environment
  const env = getEnv();
  logger.info({
    target: 'bootstrap',
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    providers: validateProviderKeys(env),
  }, 'Environment loaded');

  // Setup shutdown handlers early
  setupShutdownHandlers();

  // Create DI container
  const container = createContainer();
  logger.debug({ target: 'bootstrap' }, 'DI container created');

  // Connect to database
  await connectDatabase();

  // Verify database health
  const dbHealthy = await healthCheckDatabase();
  if (!dbHealthy) {
    throw new Error('Database health check failed');
  }
  logger.info({ target: 'bootstrap' }, 'Database connection verified');

  // Register tools
  const toolRegistry = new ToolRegistry();
  registerAllTools(toolRegistry);
  logger.info({ target: 'bootstrap', toolCount: toolRegistry.getAll().length }, 'Tools registered');

  // Policy engine
  const policyEngine = new PolicyEngine();

  // Discord client
  const discordClient = createDiscordClient();
  registerShutdownCleanup(async () => {
    await discordClient.destroy();
  });

  // Initialize AI gateway and router
  const { router } = await initializeAI();
  logger.info({ target: 'bootstrap' }, 'AI gateway initialized');

  // Initialize the request handler (agent pipeline)
  initializeRequestHandler({
    toolRegistry,
    policyEngine,
    router,
    discordClient,
  });

  // Register Discord event handlers
  discordClient.registerGuildEventHandlers();

  // Register interaction handlers (buttons, modals)
  registerApplicationInteractions();

  // Start background job scheduler (reminders, cleanup)
  startJobScheduler(discordClient, policyEngine);
  registerShutdownCleanup(() => {
    stopJobScheduler();
  });

  // Log in to Discord (resolves once READY)
  await discordClient.login();
  logger.info({ target: 'bootstrap' }, 'Discord login complete');

  const duration = Date.now() - startTime;
  logger.info({
    target: 'bootstrap',
    durationMs: duration,
  }, 'Vibe Discord Bot started successfully');
}

bootstrap().catch((error) => {
  logger.fatal({ err: error, target: 'bootstrap' }, 'Failed to start bot');
  process.exit(1);
});
