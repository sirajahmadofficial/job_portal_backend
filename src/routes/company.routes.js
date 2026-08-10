const express = require('express');
const { body } = require('express-validator');
const companyController = require('../controllers/company.controller');
const { authenticate, requireVerifiedEmail } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { validate } = require('../middlewares/validate.middleware');
const { logoUpload } = require('../middlewares/upload.middleware');

const router = express.Router();

router.get('/mine', authenticate, authorize('employer'), companyController.getMyCompany);
router.get('/:id', companyController.getCompanyById);

router.post(
  '/',
  authenticate,
  authorize('employer'),
  requireVerifiedEmail,
  [body('name').trim().notEmpty().withMessage('Company name is required')],
  validate,
  companyController.createCompany
);

router.put(
  '/',
  authenticate,
  authorize('employer'),
  requireVerifiedEmail,
  companyController.updateCompany
);

router.post(
  '/logo',
  authenticate,
  authorize('employer'),
  requireVerifiedEmail,
  logoUpload.single('logo'),
  companyController.uploadLogo
);

module.exports = router;
