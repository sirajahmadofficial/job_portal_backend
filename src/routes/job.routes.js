const express = require('express');
const { body } = require('express-validator');
const jobController = require('../controllers/job.controller');
const { authenticate, optionalAuth, requireVerifiedEmail } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');

const router = express.Router();

router.get('/', optionalAuth, jobController.listJobs);
router.get('/categories', jobController.getCategories);
router.get('/saved', authenticate, authorize('job_seeker'), jobController.getSavedJobs);
router.get('/employer/mine', authenticate, authorize('employer'), jobController.getMyJobs);
router.get('/:id', optionalAuth, jobController.getJob);

router.post(
  '/',
  authenticate,
  authorize('employer'),
  requireVerifiedEmail,
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('job_type')
      .optional()
      .isIn(['full_time', 'part_time', 'contract', 'internship', 'remote'])
      .withMessage('Invalid job type'),
  ],
  validate,
  jobController.createJob
);

router.put(
  '/:id',
  authenticate,
  authorize('employer', 'admin'),
  requireVerifiedEmail,
  jobController.updateJob
);

router.delete('/:id', authenticate, authorize('employer', 'admin'), jobController.deleteJob);
router.patch('/:id/open', authenticate, authorize('employer'), jobController.openJob);
router.patch('/:id/close', authenticate, authorize('employer'), jobController.closeJob);

router.post('/:id/save', authenticate, authorize('job_seeker'), jobController.saveJob);
router.delete('/:id/save', authenticate, authorize('job_seeker'), jobController.unsaveJob);

module.exports = router;
