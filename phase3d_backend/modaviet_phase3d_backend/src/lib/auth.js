import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { AppError } from './errors.js';

const oauth = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

export async function authenticate(request) {
  if (config.authBypassForLocal && config.env !== 'production') {
    return { email: request.headers['x-user-email'] || 'local@modaviet.vn', domain: config.allowedGoogleDomain };
  }
  if (!oauth) throw new AppError('AUTH_NOT_CONFIGURED', 'GOOGLE_CLIENT_ID chưa được cấu hình', 503);
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new AppError('AUTH_REQUIRED', 'Thiếu Google ID token', 401);
  const ticket = await oauth.verifyIdToken({ idToken: token, audience: config.googleClientId });
  const payload = ticket.getPayload() || {};
  const email = String(payload.email || '').toLowerCase();
  const hd = String(payload.hd || '').toLowerCase();
  if (!payload.email_verified) throw new AppError('AUTH_EMAIL_UNVERIFIED', 'Email Google chưa xác minh', 403);
  if (!email || hd !== config.allowedGoogleDomain.toLowerCase()) {
    throw new AppError('AUTH_DOMAIN_BLOCKED', 'Tài khoản không thuộc miền Modaviet', 403);
  }
  return { email, domain: hd, name: payload.name || '' };
}

export async function requireRole(client, email, roles) {
  const { rows } = await client.query(
    `SELECT role_code FROM app_user_role WHERE lower(email)=lower($1) AND is_active=TRUE`, [email]
  );
  const granted = new Set(rows.map(r => r.role_code));
  if (!roles.some(r => granted.has(r))) {
    throw new AppError('AUTH_ROLE_BLOCKED', 'Tài khoản không có quyền thực hiện nghiệp vụ này', 403, {required: roles});
  }
  return [...granted];
}
