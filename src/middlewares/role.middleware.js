const { AppError } = require('../utils/apiResponse');

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action.', 403)
      );
    }

    next();
  };
};

const isJobSeeker = authorize('job_seeker');
const isEmployer = authorize('employer');
const isAdmin = authorize('admin');
const isEmployerOrAdmin = authorize('employer', 'admin');

module.exports = {
  authorize,
  isJobSeeker,
  isEmployer,
  isAdmin,
  isEmployerOrAdmin,
};
