jest.setTimeout(30_000);
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();
  it('salts each password and verifies using the stored scrypt parameters', async () => {
    const first = await service.hash('long-test-password');
    const second = await service.hash('long-test-password');
    expect(first).not.toBe(second);
    expect(first).not.toContain('long-test-password');
    expect(service.isHash(first)).toBe(true);
    expect(await service.verify('long-test-password', first)).toBe(true);
    expect(await service.verify('incorrect', first)).toBe(false);
  });
  it('rejects plaintext, missing and malformed credentials without a plaintext fallback', async () => {
    for (const hash of [
      undefined,
      'old-password',
      'scrypt$131072$8$1$invalid',
      'scrypt$999999999$8$1$x$y',
    ]) {
      expect(await service.verify('old-password', hash)).toBe(false);
    }
  });
});
