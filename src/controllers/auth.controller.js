const authService = require('../services/auth.service');
const { ApiResponse } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');

const getSetupStatus = asyncHandler(async (req, res) => {
  const result = await authService.getSetupStatus();
  return ApiResponse.success(res, 200, result.message, result);
});

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  return ApiResponse.success(res, 201, result.message, {
    user: result.user,
    isFirstUser: result.isFirstUser,
  });
});

const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const result = await authService.verifyEmail(token);
  return ApiResponse.success(res, 200, result.message, { user: result.user });
});

const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email);
  return ApiResponse.success(res, 200, result.message);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  });
  return ApiResponse.success(res, 200, 'Login successful', result);
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshAccessToken(refreshToken);
  return ApiResponse.success(res, 200, 'Token refreshed', result);
});

const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.user.id, req.body.refreshToken);
  return ApiResponse.success(res, 200, result.message);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  return ApiResponse.success(res, 200, result.message);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body.token, req.body.password);
  return ApiResponse.success(res, 200, result.message);
});

const getMe = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user.id);
  return ApiResponse.success(res, 200, 'Profile fetched', result);
});

module.exports = {
  getSetupStatus,
  register,
  verifyEmail,
  resendVerification,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  getMe,
};
