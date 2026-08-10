const { verifyAccessToken } = require('../utils/generateToken');
const { query } = require('../config/database');
const { AppError } = require('../utils/apiResponse');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required. Please provide a valid token.', 401);
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('Access token expired. Please refresh your token.', 401);
      }
      throw new AppError('Invalid access token.', 401);
    }

    const { rows } = await query(
      `SELECT id, email, full_name, role, is_email_verified, is_blocked, blocked_reason
       FROM users WHERE id = $1`,
      [decoded.id]
    );
    const user = rows[0];
    if (!user) throw new AppError('User not found or token invalid.', 401);

    if (user.is_blocked) {
      throw new AppError(
        `Your account has been blocked.${user.blocked_reason ? ` Reason: ${user.blocked_reason}` : ''}`,
        403
      );
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    try {
      const decoded = verifyAccessToken(token);
      const { rows } = await query(
        `SELECT id, email, full_name, role, is_email_verified, is_blocked
         FROM users WHERE id = $1`,
        [decoded.id]
      );
      if (rows[0] && !rows[0].is_blocked) req.user = rows[0];
    } catch {
      // ignore
    }
    next();
  } catch (error) {
    next(error);
  }
};

const requireVerifiedEmail = (req, res, next) => {
  if (!req.user?.is_email_verified) {
    return next(new AppError('Please verify your email before performing this action.', 403));
  }
  next();
};

module.exports = { authenticate, optionalAuth, requireVerifiedEmail };
