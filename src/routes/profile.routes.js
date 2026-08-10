const express = require('express');
const profileController = require('../controllers/profile.controller');
const { authenticate, requireVerifiedEmail } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { resumeUpload } = require('../middlewares/upload.middleware');

const router = express.Router();

router.get('/me', authenticate, profileController.getProfile);
router.put('/me', authenticate, requireVerifiedEmail, profileController.updateProfile);
router.get('/stats', authenticate, profileController.getDashboardStats);

router.post(
  '/resume',
  authenticate,
  authorize('job_seeker'),
  requireVerifiedEmail,
  resumeUpload.single('resume'),
  profileController.uploadResume
);

router.get(
  '/:id',
  authenticate,
  authorize('employer', 'admin'),
  profileController.getPublicProfile
);

module.exports = router;
