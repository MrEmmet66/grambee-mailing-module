import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PREFIX = 'scrypt$131072$8$1$';
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

@Injectable()
export class PasswordService {
  isHash(value: string): boolean {
    return /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `${PREFIX}${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(password: string, stored?: string): Promise<boolean> {
    const validFormat = typeof stored === 'string' && this.isHash(stored);
    const parts = validFormat ? stored.split('$') : [];
    const salt = validFormat ? Buffer.from(parts[4], 'hex') : Buffer.alloc(16);
    const expected = validFormat
      ? Buffer.from(parts[5], 'hex')
      : Buffer.alloc(64);
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected) && validFormat;
  }
}
