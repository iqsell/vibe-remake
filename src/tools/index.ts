import { ToolRegistry } from './registry.js';
import { registerDiscordTools } from './discord/read-only.js';
import { registerModerationTools } from './moderation/index.js';
import { registerServerDesignTools } from './server-design/index.js';
import { registerTicketTools } from './tickets/index.js';
import { registerApplicationTools } from './applications/index.js';
import { registerStaffTools } from './staff/index.js';

export function registerAllTools(registry: ToolRegistry): void {
  registerDiscordTools(registry);
  registerModerationTools(registry);
  registerServerDesignTools(registry);
  registerTicketTools(registry);
  registerApplicationTools(registry);
  registerStaffTools(registry);
}

export { ToolRegistry } from './registry.js';
