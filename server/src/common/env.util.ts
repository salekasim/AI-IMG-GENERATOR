const DEV_LIKE = /dev|changeme|example|placeholder/i;

/**
 * Fail fast in production: refuse to boot with missing, short, or dev-looking
 * secrets. In development the local `.env` supplies values, so this only
 * guards NODE_ENV=production.
 */
export function assertProductionSecrets(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;

  const jwt = env.JWT_SECRET;
  if (!jwt || jwt.trim().length < 16 || DEV_LIKE.test(jwt)) {
    throw new Error(
      '[boot] JWT_SECRET is missing or uses a dev/weak value. ' +
        'Set a strong production value before starting.',
    );
  }

  const master = env.MASTER_KEY;
  if (!master || master.trim().length < 32 || DEV_LIKE.test(master)) {
    throw new Error(
      '[boot] MASTER_KEY is missing, too short (min 32 chars), or uses a ' +
        'dev/weak value. Set a strong production value before starting.',
    );
  }
}
