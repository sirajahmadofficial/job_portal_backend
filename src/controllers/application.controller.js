const applicationService = require('../services/application.service');
const { ApiResponse } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');

const apply = asyncHandler(async (req, res) => {
  const application = await applicationService.applyToJob(
    req.user.id,
    req.params.jobId,
    req.body
  );
  return ApiResponse.success(res, 201, 'Application submitted successfully', application);
});

const withdraw = asyncHandler(async (req, res) => {
  const application = await applicationService.withdrawApplication(
    req.params.id,
    req.user.id
  );
  return ApiResponse.success(res, 200, 'Application withdrawn', application);
});

const getMyApplications = asyncHandler(async (req, res) => {
  const result = await applicationService.getMyApplications(req.user.id, req.query);
  return ApiResponse.paginated(
    res,
    result.applications,
    result.page,
    result.limit,
    result.total,
    'Applications fetched'
  );
});

const getJobApplicants = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const result = await applicationService.getJobApplicants(
    req.params.jobId,
    req.user.id,
    req.query,
    isAdmin
  );
  return res.status(200).json({
    success: true,
    message: 'Applicants fetched',
    data: result.applications,
    job: result.job,
    meta: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / result.limit) || 1,
      hasNextPage: result.page < (Math.ceil(result.total / result.limit) || 1),
      hasPrevPage: result.page > 1,
    },
  });
});

const getEmployerApplications = asyncHandler(async (req, res) => {
  const result = await applicationService.getEmployerApplications(req.user.id, req.query);
  return ApiResponse.paginated(
    res,
    result.applications,
    result.page,
    result.limit,
    result.total,
    'Applications fetched'
  );
});

const updateStatus = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const application = await applicationService.updateApplicationStatus(
    req.params.id,
    req.user.id,
    req.body.status,
    req.body.employer_notes,
    isAdmin
  );
  return ApiResponse.success(res, 200, 'Application status updated', application);
});

const getApplication = asyncHandler(async (req, res) => {
  const application = await applicationService.getApplicationById(
    req.params.id,
    req.user.id,
    req.user.role
  );
  return ApiResponse.success(res, 200, 'Application fetched', application);
});

const getResumeUrl = asyncHandler(async (req, res) => {
  const result = await applicationService.getResumeSignedUrl(
    req.params.id,
    req.user.id,
    req.user.role
  );
  return ApiResponse.success(res, 200, 'Resume URL generated', result);
});

module.exports = {
  apply,
  withdraw,
  getMyApplications,
  getJobApplicants,
  getEmployerApplications,
  updateStatus,
  getApplication,
  getResumeUrl,
};
