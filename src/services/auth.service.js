const { query } = require('../config/database');
const { AppError } = require('../utils/apiResponse');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateRandomToken,
  hashToken,
  compareToken,
  hashPassword,
  comparePassword,
  getRefreshExpiryDate,
  getEmailTokenExpiry,
} = require('../utils/generateToken');
const emailService = require('./email.service');

const sanitizeUser = (user) => {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
};

const createTokenPair = async (user, meta = {}) => {
  const payload = { id: user.id, email: user.email, role: user.role };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);
  const tokenHash = await hashToken(refreshToken);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, tokenHash, getRefreshExpiryDate().toISOString(), meta.userAgent || null, meta.ipAddress || null]
  );

  return { accessToken, refreshToken };
};

const storeEmailToken = async (userId, type, hours = 24) => {
  const rawToken = generateRandomToken();
  const tokenHash = await hashToken(rawToken);

  await query(
    `UPDATE email_tokens SET used = true, used_at = NOW()
     WHERE user_id = $1 AND type = $2 AND used = false`,
    [userId, type]
  );

  await query(
    `INSERT INTO email_tokens (user_id, token_hash, type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, type, getEmailTokenExpiry(hours).toISOString()]
  );

  return rawToken;
};

const findValidEmailToken = async (rawToken, type) => {
  const { rows } = await query(
    `SELECT * FROM email_tokens
     WHERE type = $1 AND used = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 50`,
    [type]
  );

  for (const record of rows) {
    if (await compareToken(rawToken, record.token_hash)) return record;
  }
  return null;
};

const register = async ({ email, password, full_name, role = 'job_seeker', phone }) => {
  const allowedRoles = ['job_seeker', 'employer'];
  if (!allowedRoles.includes(role)) {
    throw new AppError('Invalid role. Register as job_seeker or employer.', 400);
  }

  const existing = await query('SELECT id FROM profiles WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows[0]) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const password_hash = await hashPassword(password);
  let user;
  try {
    const result = await query(
      `INSERT INTO profiles (email, password_hash, full_name, role, phone, is_email_verified)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING *`,
      [email.toLowerCase(), password_hash, full_name, role, phone || null]
    );
    user = result.rows[0];
  } catch (err) {
    throw new AppError(err.message || 'Registration failed', 500);
  }

  try {
    const verifyToken = await storeEmailToken(user.id, 'email_verification', 24);
    const emailResult = await emailService.sendVerificationEmail(user, verifyToken);
    if (emailResult?.success === false && process.env.NODE_ENV !== 'production') {
      // Local/dev fallback when SendGrid sender is not verified yet
      await query('UPDATE profiles SET is_email_verified = true WHERE id = $1', [user.id]);
      user.is_email_verified = true;
      console.warn(
        `[DEV] Email send failed — auto-verified ${user.email}. Fix SendGrid sender verification for real emails.`
      );
    } else if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Verification link: ${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`);
    }
  } catch (err) {
    console.error('Verification email failed:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      await query('UPDATE profiles SET is_email_verified = true WHERE id = $1', [user.id]);
      user.is_email_verified = true;
    }
  }

  return {
    user: sanitizeUser(user),
    message: 'Registration successful. Please check your email to verify your account.',
  };
};

const verifyEmail = async (token) => {
  const record = await findValidEmailToken(token, 'email_verification');
  if (!record) throw new AppError('Invalid or expired verification token.', 400);

  const { rows } = await query(
    `UPDATE profiles SET is_email_verified = true WHERE id = $1 RETURNING *`,
    [record.user_id]
  );
  if (!rows[0]) throw new AppError('Failed to verify email.', 500);

  await query(`UPDATE email_tokens SET used = true, used_at = NOW() WHERE id = $1`, [record.id]);

  return {
    user: sanitizeUser(rows[0]),
    message: 'Email verified successfully. You can now log in.',
  };
};

const resendVerification = async (email) => {
  const { rows } = await query('SELECT * FROM profiles WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user) {
    return { message: 'If an account exists with this email, a verification link has been sent.' };
  }
  if (user.is_email_verified) throw new AppError('Email is already verified.', 400);

  const token = await storeEmailToken(user.id, 'email_verification', 24);
  await emailService.sendResendVerificationEmail(user, token);
  return { message: 'If an account exists with this email, a verification link has been sent.' };
};

const login = async ({ email, password }, meta = {}) => {
  const { rows } = await query('SELECT * FROM profiles WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user) throw new AppError('Invalid email or password.', 401);

  if (user.is_blocked) {
    throw new AppError(
      `Your account has been blocked.${user.blocked_reason ? ` Reason: ${user.blocked_reason}` : ''}`,
      403
    );
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) throw new AppError('Invalid email or password.', 401);
  if (!user.is_email_verified) {
    throw new AppError('Please verify your email before logging in.', 403);
  }

  await query('UPDATE profiles SET last_login_at = NOW() WHERE id = $1', [user.id]);
  const tokens = await createTokenPair(user, meta);
  return { user: sanitizeUser(user), ...tokens };
};

const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) throw new AppError('Refresh token is required.', 400);

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  const { rows } = await query(
    `SELECT * FROM refresh_tokens
     WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 20`,
    [decoded.id]
  );

  let matched = null;
  for (const record of rows) {
    if (await compareToken(refreshToken, record.token_hash)) {
      matched = record;
      break;
    }
  }
  if (!matched) throw new AppError('Refresh token is invalid or has been revoked.', 401);

  const userRes = await query('SELECT * FROM profiles WHERE id = $1', [decoded.id]);
  const user = userRes.rows[0];
  if (!user || user.is_blocked) throw new AppError('User not found or blocked.', 401);

  await query(
    `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW() WHERE id = $1`,
    [matched.id]
  );

  const tokens = await createTokenPair(user);
  return { user: sanitizeUser(user), ...tokens };
};

const logout = async (userId, refreshToken) => {
  if (refreshToken) {
    const { rows } = await query(
      `SELECT * FROM refresh_tokens WHERE user_id = $1 AND revoked = false`,
      [userId]
    );
    for (const record of rows) {
      if (await compareToken(refreshToken, record.token_hash)) {
        await query(
          `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW() WHERE id = $1`,
          [record.id]
        );
        break;
      }
    }
  } else {
    await query(
      `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
       WHERE user_id = $1 AND revoked = false`,
      [userId]
    );
  }
  return { message: 'Logged out successfully.' };
};

const forgotPassword = async (email) => {
  const { rows } = await query('SELECT * FROM profiles WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user) {
    return { message: 'If an account exists with this email, a password reset link has been sent.' };
  }
  const token = await storeEmailToken(user.id, 'password_reset', 1);
  await emailService.sendPasswordResetEmail(user, token);
  return { message: 'If an account exists with this email, a password reset link has been sent.' };
};

const resetPassword = async (token, newPassword) => {
  const record = await findValidEmailToken(token, 'password_reset');
  if (!record) throw new AppError('Invalid or expired password reset token.', 400);

  const password_hash = await hashPassword(newPassword);
  await query('UPDATE profiles SET password_hash = $1 WHERE id = $2', [
    password_hash,
    record.user_id,
  ]);
  await query(`UPDATE email_tokens SET used = true, used_at = NOW() WHERE id = $1`, [record.id]);
  await query(
    `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
     WHERE user_id = $1 AND revoked = false`,
    [record.user_id]
  );

  return { message: 'Password reset successfully. Please log in with your new password.' };
};

const getMe = async (userId) => {
  const { rows } = await query('SELECT * FROM profiles WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user) throw new AppError('User not found.', 404);

  let company = null;
  if (user.role === 'employer') {
    const companyRes = await query('SELECT * FROM companies WHERE employer_id = $1', [userId]);
    company = companyRes.rows[0] || null;
  }

  return { user: sanitizeUser(user), company };
};

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  refreshAccessToken,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
  sanitizeUser,
};
