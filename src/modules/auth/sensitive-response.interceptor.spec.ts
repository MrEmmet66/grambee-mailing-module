import { sanitizeResponse } from './sensitive-response.interceptor';
describe('Sensitive response boundary', () => {
  it('allows tokens only at the top level of explicitly marked authentication responses', () => {
    const payload = {
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        id: 7,
        passwordHash: 'secret',
        refreshToken: 'secret',
        refreshTokenHash: 'secret',
        BotSeller: [
          {
            botToken: 'secret',
            usersData: ['secret'],
            statisticsFilePath: 'secret',
            id: 1,
          },
        ],
      },
    };
    expect(sanitizeResponse(payload, true)).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 7, BotSeller: [{ id: 1 }] },
    });
    expect(sanitizeResponse(payload)).toEqual({
      user: { id: 7, BotSeller: [{ id: 1 }] },
    });
  });
});
