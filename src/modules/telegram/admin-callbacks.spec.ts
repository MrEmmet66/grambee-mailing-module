import { Context } from 'telegraf';
import { adminCallbacksOnly } from './admin-callbacks';

describe('Telegram moderation boundary', () => {
  it('rejects callback actions outside the configured admin chat', async () => {
    const next = jest.fn();
    const answerCbQuery = jest.fn().mockResolvedValue(undefined);
    const context = {
      callbackQuery: {},
      chat: { id: 123 },
      answerCbQuery,
    } as unknown as Context;
    await adminCallbacksOnly('-100123')(context, next);
    expect(next).not.toHaveBeenCalled();
    expect(answerCbQuery).toHaveBeenCalledWith('Not authorized');
  });
  it('allows callbacks in the configured admin chat', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    const context = {
      callbackQuery: {},
      chat: { id: -100123 },
    } as unknown as Context;
    await adminCallbacksOnly('-100123')(context, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
