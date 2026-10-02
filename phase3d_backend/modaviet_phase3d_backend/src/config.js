function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

export const config = Object.freeze({
  port: intEnv('PORT', 8080),
  env: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  dbUser: process.env.DB_USER || '',
  dbPassword: process.env.DB_PASSWORD || '',
  dbName: process.env.DB_NAME || 'modaviet_kho',
  cloudSqlInstance: process.env.INSTANCE_CONNECTION_NAME || '',
  dbPoolMax: intEnv('DB_POOL_MAX', 10),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  allowedGoogleDomain: process.env.ALLOWED_GOOGLE_DOMAIN || 'modaviet.vn',
  authBypassForLocal: String(process.env.AUTH_BYPASS_FOR_LOCAL || 'false').toLowerCase() === 'true',
  performanceTargetP95Ms: intEnv('PERFORMANCE_TARGET_P95_MS', 1500)
});
