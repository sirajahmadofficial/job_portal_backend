const express = require('express');
const { body } = require('express-validator');
const applicationController = require('../controllers/application.controller');
const { authenticate, requireVerifiedEmail } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');

const router = express.Router();

router.get(
  '/mine',
  authenticate,
  authorize('job_seeker'),
  applicationController.getMyApplications
);

router.get(
  '/employer',
  authenticate,
  authorize('employer'),
  applicationController.getEmployerApplications
);

router.get(
  '/job/:jobId',
  authenticate,
  authorize('employer', 'admin'),
  applicationController.getJobApplicants
);

router.get('/:id', authenticate, applicationController.getApplication);

router.get(
  '/:id/resume',
  authenticate,
  authorize('employer', 'admin', 'job_seeker'),
  applicationController.getResumeUrl
);

router.post(
  '/job/:jobId',
  authenticate,
  authorize('job_seeker'),
  requireVerifiedEmail,
  [body('cover_letter').optional().isString()],
  validate,
  applicationController.apply
);

router.patch(
  '/:id/withdraw',
  authenticate,
  authorize('job_seeker'),
  applicationController.withdraw
);

router.patch(
  '/:id/status',
  authenticate,
  authorize('employer', 'admin'),
  [
    body('status')
      .isIn(['pending', 'reviewing', 'shortlisted', 'rejected', 'hired'])
      .withMessage('Invalid application status'),
  ],
  validate,
  applicationController.updateStatus
);

module.exports = router;
