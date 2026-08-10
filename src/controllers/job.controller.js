const jobService = require('../services/job.service');
const { ApiResponse } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');

const listJobs = asyncHandler(async (req, res) => {
  const result = await jobService.listJobs(req.query, req.user?.id);
  return ApiResponse.paginated(
    res,
    result.jobs,
    result.page,
    result.limit,
    result.total,
    'Jobs fetched successfully'
  );
});

const getJob = asyncHandler(async (req, res) => {
  const job = await jobService.getJobById(req.params.id, req.user?.id);
  return ApiResponse.success(res, 200, 'Job fetched successfully', job);
});

const createJob = asyncHandler(async (req, res) => {
  const job = await jobService.createJob(req.user.id, req.body);
  return ApiResponse.success(res, 201, 'Job created successfully', job);
});

const updateJob = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const job = await jobService.updateJob(req.params.id, req.user.id, req.body, isAdmin);
  return ApiResponse.success(res, 200, 'Job updated successfully', job);
});

const deleteJob = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const result = await jobService.deleteJob(req.params.id, req.user.id, isAdmin);
  return ApiResponse.success(res, 200, result.message);
});

const openJob = asyncHandler(async (req, res) => {
  const job = await jobService.setJobStatus(req.params.id, req.user.id, 'open');
  return ApiResponse.success(res, 200, 'Job opened successfully', job);
});

const closeJob = asyncHandler(async (req, res) => {
  const job = await jobService.setJobStatus(req.params.id, req.user.id, 'closed');
  return ApiResponse.success(res, 200, 'Job closed successfully', job);
});

const getMyJobs = asyncHandler(async (req, res) => {
  const result = await jobService.getEmployerJobs(req.user.id, req.query);
  return ApiResponse.paginated(
    res,
    result.jobs,
    result.page,
    result.limit,
    result.total,
    'Employer jobs fetched'
  );
});

const getCategories = asyncHandler(async (req, res) => {
  const categories = await jobService.getCategories();
  return ApiResponse.success(res, 200, 'Categories fetched', categories);
});

const saveJob = asyncHandler(async (req, res) => {
  const data = await jobService.saveJob(req.user.id, req.params.id);
  return ApiResponse.success(res, 201, 'Job saved successfully', data);
});

const unsaveJob = asyncHandler(async (req, res) => {
  const result = await jobService.unsaveJob(req.user.id, req.params.id);
  return ApiResponse.success(res, 200, result.message);
});

const getSavedJobs = asyncHandler(async (req, res) => {
  const result = await jobService.getSavedJobs(req.user.id, req.query);
  return ApiResponse.paginated(
    res,
    result.jobs,
    result.page,
    result.limit,
    result.total,
    'Saved jobs fetched'
  );
});

module.exports = {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  openJob,
  closeJob,
  getMyJobs,
  getCategories,
  saveJob,
  unsaveJob,
  getSavedJobs,
};
