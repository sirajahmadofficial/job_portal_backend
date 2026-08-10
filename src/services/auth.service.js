const { supabase } = require('../config/database');
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

  await supabase.from('refresh_tokens').insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: getRefreshExpiryDate().toISOString(),
    user_agent: meta.userAgent || null,
    ip_address: meta.ipAddress || null,
  });

  return { accessToken, refreshToken };
};

const storeEmailToken = async (userId, type, hours = 24) => {
  const rawToken = generateRandomToken();
  const tokenHash = await hashToken(rawToken);

  // Invalidate previous unused tokens of same type
  await supabase
    .from('email_tokens')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('type', type)
    .eq('used', false);

  await supabase.from('email_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    type,
    expires_at: getEmailTokenExpiry(hours).toISOString(),
  });

  return rawToken;
};

const findValidEmailToken = async (rawToken, type) => {
  const { data: tokens, error } = await supabase
    .from('email_tokens')
    .select('*')
    .eq('type', type)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new AppError('Failed to validate token', 500);

  for (const record of tokens || []) {
    const match = await compareToken(rawToken, record.token_hash);
    if (match) return record;
  }
  return null;
};

const register = async ({ email, password, full_name, role = 'job_seeker', phone }) => {
  const allowedRoles = ['job_seeker', 'employer'];
  if (!allowedRoles.includes(role)) {
    throw new AppError('Invalid role. Register as job_seeker or employer.', 400);
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const password_hash = await hashPassword(password);

  const { data: user, error } = await supabase
    .from('profiles')
    .insert({
      email: email.toLowerCase(),
      password_hash,
      full_name,
      role,
      phone: phone || null,
      is_email_verified: false,
    })
    .select('*')
    .single();

  if (error) {
    throw new AppError(error.message || 'Registration failed', 500);
  }

  const verifyToken = await storeEmailToken(user.id, 'email_verification', 24);
  await emailService.sendVerificationEmail(user, verifyToken);

  return {
    user: sanitizeUser(user),
    message: 'Registration successful. Please check your email to verify your account.',
  };
};

const verifyEmail = async (token) => {
  const record = await findValidEmailToken(token, 'email_verification');
  if (!record) {
    throw new AppError('Invalid or expired verification token.', 400);
  }

  const { data: user, error } = await supabase
    .from('profiles')
    .update({ is_email_verified: true })
    .eq('id', record.user_id)
    .select('*')
    .single();

  if (error || !user) {
    throw new AppError('Failed to verify email.', 500);
  }

  await supabase
    .from('email_tokens')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('id', record.id);

  return { user: sanitizeUser(user), message: 'Email verified successfully. You can now log in.' };
};

const resendVerification = async (email) => {
  const { data: user } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!user) {
    // Don't reveal whether email exists
    return { message: 'If an account exists with this email, a verification link has been sent.' };
  }

  if (user.is_email_verified) {
    throw new AppError('Email is already verified.', 400);
  }

  const token = await storeEmailToken(user.id, 'email_verification', 24);
  await emailService.sendResendVerificationEmail(user, token);

  return { message: 'If an account exists with this email, a verification link has been sent.' };
};

const login = async ({ email, password }, meta = {}) => {
  const { data: user, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (error || !user) {
    throw new AppError('Invalid email or password.', 401);
  }

  if (user.is_blocked) {
    throw new AppError(
      `Your account has been blocked.${user.blocked_reason ? ` Reason: ${user.blocked_reason}` : ''}`,
      403
    );
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    throw new AppError('Invalid email or password.', 401);
  }

  if (!user.is_email_verified) {
    throw new AppError('Please verify your email before logging in.', 403);
  }

  await supabase
    .from('profiles')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', user.id);

  const tokens = await createTokenPair(user, meta);

  return {
    user: sanitizeUser(user),
    ...tokens,
  };
};

const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) {
    throw new AppError('Refresh token is required.', 400);
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token.', 401);
  }

  const { data: storedTokens } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('user_id', decoded.id)
    .eq('revoked', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  let matched = null;
  for (const record of storedTokens || []) {
    const ok = await compareToken(refreshToken, record.token_hash);
    if (ok) {
      matched = record;
      break;
    }
  }

  if (!matched) {
    throw new AppError('Refresh token is invalid or has been revoked.', 401);
  }

  const { data: user } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', decoded.id)
    .single();

  if (!user || user.is_blocked) {
    throw new AppError('User not found or blocked.', 401);
  }

  // Rotate refresh token
  await supabase
    .from('refresh_tokens')
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq('id', matched.id);

  const tokens = await createTokenPair(user);

  return {
    user: sanitizeUser(user),
    ...tokens,
  };
};

const logout = async (userId, refreshToken) => {
  if (refreshToken) {
    const { data: storedTokens } = await supabase
      .from('refresh_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('revoked', false);

    for (const record of storedTokens || []) {
      const ok = await compareToken(refreshToken, record.token_hash);
      if (ok) {
        await supabase
          .from('refresh_tokens')
          .update({ revoked: true, revoked_at: new Date().toISOString() })
          .eq('id', record.id);
        break;
      }
    }
  } else {
    await supabase
      .from('refresh_tokens')
      .update({ revoked: true, revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('revoked', false);
  }

  return { message: 'Logged out successfully.' };
};

const forgotPassword = async (email) => {
  const { data: user } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!user) {
    return { message: 'If an account exists with this email, a password reset link has been sent.' };
  }

  const token = await storeEmailToken(user.id, 'password_reset', 1);
  await emailService.sendPasswordResetEmail(user, token);

  return { message: 'If an account exists with this email, a password reset link has been sent.' };
};

const resetPassword = async (token, newPassword) => {
  const record = await findValidEmailToken(token, 'password_reset');
  if (!record) {
    throw new AppError('Invalid or expired password reset token.', 400);
  }

  const password_hash = await hashPassword(newPassword);

  const { error } = await supabase
    .from('profiles')
    .update({ password_hash })
    .eq('id', record.user_id);

  if (error) {
    throw new AppError('Failed to reset password.', 500);
  }

  await supabase
    .from('email_tokens')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('id', record.id);

  // Revoke all refresh tokens
  await supabase
    .from('refresh_tokens')
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq('user_id', record.user_id)
    .eq('revoked', false);

  return { message: 'Password reset successfully. Please log in with your new password.' };
};

const getMe = async (userId) => {
  const { data: user, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw new AppError('User not found.', 404);
  }

  let company = null;
  if (user.role === 'employer') {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .eq('employer_id', userId)
      .maybeSingle();
    company = data;
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
