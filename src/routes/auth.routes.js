const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

const router = express.Router();

router.get('/setup-status', authController.getSetupStatus);

router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/)
      .withMessage('Password must contain an uppercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain a number'),
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('role').optional().isIn(['job_seeker', 'employer']).withMessage('Invalid role'),
  ],
  validate,
  authController.register
);

router.post(
  '/verify-email',
  [body('token').notEmpty().withMessage('Verification token is required')],
  validate,
  authController.verifyEmail
);

router.post(
  '/resend-verification',
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  authController.resendVerification
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  authController.login
);

router.post(
  '/refresh-token',
  [body('refreshToken').notEmpty().withMessage('Refresh token is required')],
  validate,
  authController.refreshToken
);

router.post('/logout', authenticate, authController.logout);

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  authController.forgotPassword
);

router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/[A-Z]/)
      .withMessage('Password must contain an uppercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain a number'),
  ],
  validate,
  authController.resetPassword
);

router.get('/me', authenticate, authController.getMe);

module.exports = router;
