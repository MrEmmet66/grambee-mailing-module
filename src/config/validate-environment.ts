export function validateEnvironment(config: Record<string, unknown>) {
  for (const key of ['JWT_SECRET', 'SECRET_KEY']) {
    const value = config[key];
    if (
      typeof value !== 'string' ||
      value.length < 32 ||
      /^(change-me|super-secret)/i.test(value)
    ) {
      throw new Error(
        `${key} must be a random secret of at least 32 characters`,
      );
    }
  }
  if (config.JWT_SECRET === config.SECRET_KEY)
    throw new Error('JWT_SECRET and SECRET_KEY must be different');
  return config;
}
