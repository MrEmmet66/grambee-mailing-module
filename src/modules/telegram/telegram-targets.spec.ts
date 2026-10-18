import { ConfigService } from '@nestjs/config';
import { resolveTelegramTargets } from './telegram-targets';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue,
  } as unknown as ConfigService;
}

describe('resolveTelegramTargets', () => {
  it('reads the admin chat and topic ids from configuration', () => {
    const targets = resolveTelegramTargets(
      configWith({
        ADMIN_CHAT_ID: '-100111',
        MAILINGS_CHAT_ID: '-100222',
        BOT_APPLICATIONS_TOPIC_ID: '9',
        MAILING_APPLICATIONS_TOPIC_ID: 12,
        MAILING_NOTIFY_TOPIC_ID: '14',
      }),
    );

    expect(targets).toEqual({
      adminChatId: '-100111',
      mailingsChatId: '-100222',
      botApplicationsTopicId: 9,
      mailingApplicationsTopicId: 12,
      mailingNotifyTopicId: 14,
    });
  });

  it('falls back to the admin chat when MAILINGS_CHAT_ID is not set', () => {
    const targets = resolveTelegramTargets(
      configWith({ ADMIN_CHAT_ID: '-100111' }),
    );

    expect(targets.mailingsChatId).toBe('-100111');
  });

  it('resolves missing or invalid topic ids to 0', () => {
    const targets = resolveTelegramTargets(
      configWith({
        ADMIN_CHAT_ID: '-100111',
        BOT_APPLICATIONS_TOPIC_ID: 'not-a-number',
        MAILING_NOTIFY_TOPIC_ID: '-3',
      }),
    );

    expect(targets.botApplicationsTopicId).toBe(0);
    expect(targets.mailingApplicationsTopicId).toBe(0);
    expect(targets.mailingNotifyTopicId).toBe(0);
  });

  it('throws when the admin chat is not configured', () => {
    expect(() => resolveTelegramTargets(configWith({}))).toThrow(
      /ADMIN_CHAT_ID/,
    );
  });
});
