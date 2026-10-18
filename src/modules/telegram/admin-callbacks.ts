import { Context, MiddlewareFn } from 'telegraf';

// Moderation keyboards are valid only inside the configured private admin chat.
export function adminCallbacksOnly(adminChatId: string): MiddlewareFn<Context> {
  return async (context, next) => {
    if (context.callbackQuery && String(context.chat?.id) !== adminChatId) {
      await context.answerCbQuery('Not authorized');
      return;
    }
    return next();
  };
}
