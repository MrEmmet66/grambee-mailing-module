import { validateEnvironment } from './validate-environment';
describe('Secret configuration', () => {
  it('fails closed for missing, weak, placeholder and reused secrets', () => {
    for (const config of [
      {},
      { JWT_SECRET: 'short', SECRET_KEY: 'short' },
      {
        JWT_SECRET: 'same-value-with-at-least-32-characters',
        SECRET_KEY: 'same-value-with-at-least-32-characters',
      },
    ])
      expect(() => validateEnvironment(config)).toThrow();
  });
});
