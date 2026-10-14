import { RESTJSONErrorCodes, DiscordAPIError } from 'discord.js';

export enum DiscordErrorClass {
  // Authentication & Authorization
  INVALID_TOKEN = 'INVALID_TOKEN',
  MISSING_PERMISSIONS = 'MISSING_PERMISSIONS',
  MISSING_ACCESS = 'MISSING_ACCESS',
  
  // Rate Limiting
  RATE_LIMITED = 'RATE_LIMITED',
  
  // Not Found
  UNKNOWN_CHANNEL = 'UNKNOWN_CHANNEL',
  UNKNOWN_GUILD = 'UNKNOWN_GUILD',
  UNKNOWN_ROLE = 'UNKNOWN_ROLE',
  UNKNOWN_MEMBER = 'UNKNOWN_MEMBER',
  UNKNOWN_MESSAGE = 'UNKNOWN_MESSAGE',
  UNKNOWN_USER = 'UNKNOWN_USER',
  
  // Validation
  INVALID_FORM_BODY = 'INVALID_FORM_BODY',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  MAXIMUM_GUILDS = 'MAXIMUM_GUILDS',
  MAXIMUM_ROLES = 'MAXIMUM_ROLES',
  MAXIMUM_CHANNELS = 'MAXIMUM_CHANNELS',
  
  // Hierarchy
  HIERARCHY_VIOLATION = 'HIERARCHY_VIOLATION',
  CANNOT_EXECUTE_ON_ROLE = 'CANNOT_EXECUTE_ON_ROLE',
  
  // State
  GUILD_MFA_REQUIRED = 'GUILD_MFA_REQUIRED',
  STAGE_ALREADY_OPEN = 'STAGE_ALREADY_OPEN',
  
  // Transient
  GATEWAY_UNAVAILABLE = 'GATEWAY_UNAVAILABLE',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  
  // Content
  MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG',
  EMBED_TOO_LARGE = 'EMBED_TOO_LARGE',
  INVALID_EMBED = 'INVALID_EMBED',
  
  // Unknown
  UNKNOWN = 'UNKNOWN',
}

export interface ClassifiedDiscordError {
  errorClass: DiscordErrorClass;
  retryable: boolean;
  userMessage: string;
  technicalDetails: string;
  retryAfterMs?: number;
  statusCode?: number;
  discordCode?: number;
}

const ERROR_CODE_MAP: Record<number, DiscordErrorClass> = {
  [RESTJSONErrorCodes.UnknownAccount]: DiscordErrorClass.UNKNOWN_USER,
  [RESTJSONErrorCodes.UnknownApplication]: DiscordErrorClass.UNKNOWN,
  [RESTJSONErrorCodes.UnknownChannel]: DiscordErrorClass.UNKNOWN_CHANNEL,
  [RESTJSONErrorCodes.UnknownGuild]: DiscordErrorClass.UNKNOWN_GUILD,
  [RESTJSONErrorCodes.UnknownIntegration]: DiscordErrorClass.UNKNOWN,
  [RESTJSONErrorCodes.UnknownInvite]: DiscordErrorClass.UNKNOWN,
  [RESTJSONErrorCodes.UnknownMember]: DiscordErrorClass.UNKNOWN_MEMBER,
  [RESTJSONErrorCodes.UnknownMessage]: DiscordErrorClass.UNKNOWN_MESSAGE,
  [RESTJSONErrorCodes.UnknownPermissionOverwrite]: DiscordErrorClass.UNKNOWN,
  [RESTJSONErrorCodes.UnknownProvider]: DiscordErrorClass.UNKNOWN,
  [RESTJSONErrorCodes.UnknownRole]: DiscordErrorClass.UNKNOWN_ROLE,
  [RESTJSONErrorCodes.UnknownToken]: DiscordErrorClass.INVALID_TOKEN,
  [RESTJSONErrorCodes.UnknownWebhook]: DiscordErrorClass.UNKNOWN,
  [RESTJSONErrorCodes.Unauthorized]: DiscordErrorClass.INVALID_TOKEN,
  [RESTJSONErrorCodes.MissingAccess]: DiscordErrorClass.MISSING_ACCESS,
  [RESTJSONErrorCodes.InvalidToken]: DiscordErrorClass.INVALID_TOKEN,
  [RESTJSONErrorCodes.MaximumNumberOfGuildsReached]: DiscordErrorClass.MAXIMUM_GUILDS,
  [RESTJSONErrorCodes.MaximumNumberOfGuildRolesReached]: DiscordErrorClass.MAXIMUM_ROLES,
  [RESTJSONErrorCodes.MaximumNumberOfGuildChannelsReached]: DiscordErrorClass.MAXIMUM_CHANNELS,
  [RESTJSONErrorCodes.MissingPermissions]: DiscordErrorClass.MISSING_PERMISSIONS,
  [RESTJSONErrorCodes.InvalidFormBodyOrContentType]: DiscordErrorClass.INVALID_FORM_BODY,
  [RESTJSONErrorCodes.TwoFactorAuthenticationIsRequired]: DiscordErrorClass.GUILD_MFA_REQUIRED,
  [RESTJSONErrorCodes.TheStageIsAlreadyOpen]: DiscordErrorClass.STAGE_ALREADY_OPEN,
};

const RETRYABLE_CLASSES = new Set([
  DiscordErrorClass.RATE_LIMITED,
  DiscordErrorClass.GATEWAY_UNAVAILABLE,
  DiscordErrorClass.INTERNAL_SERVER_ERROR,
  DiscordErrorClass.SERVICE_UNAVAILABLE,
]);

const HIERARCHY_CODES = new Set([
  RESTJSONErrorCodes.MissingPermissions,
]);

function extractRetryAfter(error: DiscordAPIError): number | undefined {
  // Discord returns retry_after in the response body for rate limits
  if (error.rawError && typeof error.rawError === 'object' && 'retry_after' in error.rawError) {
    const retryAfter = (error.rawError as any).retry_after;
    if (typeof retryAfter === 'number') {
      return Math.ceil(retryAfter * 1000); // Convert to milliseconds
    }
  }
  
  // Also check headers if available
  if (error.status === 429 && error.rawError && typeof error.rawError === 'object' && 'retry_after' in error.rawError) {
    const retryAfterHeader = (error.rawError as any).retry_after;
    if (typeof retryAfterHeader === 'number') {
      return retryAfterHeader * 1000;
    }
  }

  return undefined;
}

export function classifyDiscordError(error: unknown): ClassifiedDiscordError {
  // Handle non-APIError cases
  if (!(error instanceof Error)) {
    return {
      errorClass: DiscordErrorClass.UNKNOWN,
      retryable: false,
      userMessage: 'An unknown error occurred',
      technicalDetails: String(error),
    };
  }

  // Check if it's a Discord APIError
  if (!('code' in error) || !('status' in error)) {
    return {
      errorClass: DiscordErrorClass.UNKNOWN,
      retryable: false,
      userMessage: error.message,
      technicalDetails: error.stack ?? error.message,
    };
  }

  const apiError = error as DiscordAPIError;
  const discordCode = typeof apiError.code === 'number' ? apiError.code : Number(apiError.code);
  const statusCode = apiError.status;

  // Get error class from code map
  const errorClass = ERROR_CODE_MAP[discordCode] ?? DiscordErrorClass.UNKNOWN;
  
  // Special handling for rate limits
  let finalErrorClass = errorClass;
  if (statusCode === 429) {
    finalErrorClass = DiscordErrorClass.RATE_LIMITED;
  }

  // Special handling for 5xx errors
  if (statusCode >= 500) {
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      finalErrorClass = DiscordErrorClass.SERVICE_UNAVAILABLE;
    } else {
      finalErrorClass = DiscordErrorClass.INTERNAL_SERVER_ERROR;
    }
  }

  // Special handling for hierarchy violations
  if (HIERARCHY_CODES.has(discordCode)) {
    // Check if it's specifically a hierarchy issue
    if (apiError.message?.includes('hierarchy') || apiError.message?.includes('role position')) {
      finalErrorClass = DiscordErrorClass.HIERARCHY_VIOLATION;
    }
  }

  const retryable = RETRYABLE_CLASSES.has(finalErrorClass);
  const retryAfterMs = extractRetryAfter(apiError);

  // Generate user-friendly message
  const userMessage = getUserMessage(finalErrorClass, apiError.message);
  const technicalDetails = `${apiError.message} (code: ${discordCode}, status: ${statusCode})`;

  return {
    errorClass: finalErrorClass,
    retryable,
    userMessage,
    technicalDetails,
    retryAfterMs,
    statusCode,
    discordCode,
  };
}

function getUserMessage(errorClass: DiscordErrorClass, originalMessage?: string): string {
  switch (errorClass) {
    case DiscordErrorClass.INVALID_TOKEN:
      return 'Bot authentication failed. Please check the bot token.';
    case DiscordErrorClass.MISSING_PERMISSIONS:
      return 'I don\'t have the required permissions to perform this action.';
    case DiscordErrorClass.MISSING_ACCESS:
      return 'I don\'t have access to that channel or resource.';
    case DiscordErrorClass.RATE_LIMITED:
      return 'Discord is rate limiting requests. Please wait a moment and try again.';
    case DiscordErrorClass.UNKNOWN_CHANNEL:
      return 'That channel no longer exists or I can\'t see it.';
    case DiscordErrorClass.UNKNOWN_GUILD:
      return 'That server no longer exists or I\'m not in it.';
    case DiscordErrorClass.UNKNOWN_ROLE:
      return 'That role no longer exists.';
    case DiscordErrorClass.UNKNOWN_MEMBER:
      return 'That user is not in this server.';
    case DiscordErrorClass.UNKNOWN_MESSAGE:
      return 'That message no longer exists.';
    case DiscordErrorClass.UNKNOWN_USER:
      return 'That user could not be found.';
    case DiscordErrorClass.INVALID_FORM_BODY:
      return 'Invalid request data sent to Discord.';
    case DiscordErrorClass.INVALID_PARAMETER:
      return 'Invalid parameter provided to Discord API.';
    case DiscordErrorClass.MAXIMUM_GUILDS:
      return 'Maximum number of guilds reached.';
    case DiscordErrorClass.MAXIMUM_ROLES:
      return 'This server has reached the maximum number of roles.';
    case DiscordErrorClass.MAXIMUM_CHANNELS:
      return 'This server has reached the maximum number of channels.';
    case DiscordErrorClass.HIERARCHY_VIOLATION:
      return 'Cannot perform this action due to role hierarchy. The target\'s highest role is above mine.';
    case DiscordErrorClass.CANNOT_EXECUTE_ON_ROLE:
      return 'Cannot perform this action on that role due to hierarchy.';
    case DiscordErrorClass.GUILD_MFA_REQUIRED:
      return 'This server requires 2FA for moderation actions.';
    case DiscordErrorClass.GATEWAY_UNAVAILABLE:
      return 'Discord gateway is temporarily unavailable. Please try again.';
    case DiscordErrorClass.INTERNAL_SERVER_ERROR:
      return 'Discord is experiencing internal issues. Please try again later.';
    case DiscordErrorClass.SERVICE_UNAVAILABLE:
      return 'Discord service is temporarily unavailable. Please try again later.';
    case DiscordErrorClass.MESSAGE_TOO_LONG:
      return 'The message is too long to send.';
    case DiscordErrorClass.EMBED_TOO_LARGE:
      return 'The embed is too large to send.';
    case DiscordErrorClass.INVALID_EMBED:
      return 'Invalid embed format.';
    default:
      return originalMessage ?? 'An unknown Discord API error occurred.';
  }
}

export function isRetryableError(error: unknown): boolean {
  const classified = classifyDiscordError(error);
  return classified.retryable;
}

export function getRetryAfter(error: unknown): number | undefined {
  const classified = classifyDiscordError(error);
  return classified.retryAfterMs;
}

export function isHierarchyError(error: unknown): boolean {
  const classified = classifyDiscordError(error);
  return classified.errorClass === DiscordErrorClass.HIERARCHY_VIOLATION ||
         classified.errorClass === DiscordErrorClass.CANNOT_EXECUTE_ON_ROLE;
}

export function isPermissionError(error: unknown): boolean {
  const classified = classifyDiscordError(error);
  return classified.errorClass === DiscordErrorClass.MISSING_PERMISSIONS ||
         classified.errorClass === DiscordErrorClass.MISSING_ACCESS;
}

export function isNotFoundError(error: unknown): boolean {
  const classified = classifyDiscordError(error);
  return [
    DiscordErrorClass.UNKNOWN_CHANNEL,
    DiscordErrorClass.UNKNOWN_GUILD,
    DiscordErrorClass.UNKNOWN_ROLE,
    DiscordErrorClass.UNKNOWN_MEMBER,
    DiscordErrorClass.UNKNOWN_MESSAGE,
    DiscordErrorClass.UNKNOWN_USER,
  ].includes(classified.errorClass);
}