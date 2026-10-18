import { ConfigService } from '@nestjs/config';

export interface TelegramTargets {
  adminChatId: string;
  mailingsChatId: string;
  botApplicationsTopicId: number;
  mailingApplicationsTopicId: number;
  mailingNotifyTopicId: number;
}

/**
 * Resolves the admin chat and the topic ids from configuration.
 *
 * Chat and topic ids are environment specific and must not live in the code:
 * they are read from ADMIN_CHAT_ID, MAILINGS_CHAT_ID and the *_TOPIC_ID variables
 * (see .env.example). MAILINGS_CHAT_ID falls back to the admin chat, and a topic
 * id that is missing or invalid resolves to 0 (no thread).
 */
export function resolveTelegramTargets(config: ConfigService): TelegramTargets {
  const adminChatId = config.get<string>('ADMIN_CHAT_ID');
  if (!adminChatId) {
    throw new Error(
      'ADMIN_CHAT_ID is not configured. Set it in the environment.',
    );
  }

  return {
    adminChatId,
    mailingsChatId: config.get<string>('MAILINGS_CHAT_ID') || adminChatId,
    botApplicationsTopicId: toTopicId(config.get('BOT_APPLICATIONS_TOPIC_ID')),
    mailingApplicationsTopicId: toTopicId(
      config.get('MAILING_APPLICATIONS_TOPIC_ID'),
    ),
    mailingNotifyTopicId: toTopicId(config.get('MAILING_NOTIFY_TOPIC_ID')),
  };
}

function toTopicId(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
