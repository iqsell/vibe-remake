export * from './types.js';
export { AIGateway, getAIGateway, resetAIGateway } from './gateway.js';
export { ProviderRouter, getProviderRouter, resetProviderRouter } from './router.js';
export * from './errors.js';
export * from './normalizers/base.js';
export * from './providers/index.js';
export * from './failover/index.js';

import { AIGateway, getAIGateway } from './gateway.js';
import { ProviderRouter, getProviderRouter } from './router.js';
import { initializeProviders } from './providers/index.js';

export async function initializeAI(): Promise<{ gateway: AIGateway; router: ProviderRouter }> {
  const gateway = getAIGateway();
  await initializeProviders(gateway);
  const router = getProviderRouter(gateway);
  return { gateway, router };
}