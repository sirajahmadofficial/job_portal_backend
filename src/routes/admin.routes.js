const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/stats', adminController.getStats);
router.get('/users', adminController.listUsers);
router.patch('/users/:id/block', adminController.blockUser);
router.patch('/users/:id/unblock', adminController.unblockUser);

router.get('/companies', adminController.listCompanies);
router.patch('/companies/:id/toggle', adminController.toggleCompany);

router.get('/jobs', adminController.listJobs);
router.patch('/jobs/:id/flag', adminController.flagJob);
router.patch('/jobs/:id/unflag', adminController.unflagJob);
router.delete('/jobs/:id', adminController.deleteJob);

router.get('/applications', adminController.listApplications);

router.post(
  '/create-admin',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 chars'),
    body('full_name').notEmpty().withMessage('Full name required'),
  ],
  validate,
  adminController.createAdmin
);

module.exports = router;
