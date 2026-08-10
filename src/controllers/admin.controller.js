const { supabase } = require('../config/database');
const { ApiResponse, AppError } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');
const { hashPassword } = require('../utils/generateToken');

const getStats = asyncHandler(async (req, res) => {
  const [
    { count: totalUsers },
    { count: jobSeekers },
    { count: employers },
    { count: blockedUsers },
    { count: totalCompanies },
    { count: totalJobs },
    { count: activeJobs },
    { count: suspiciousJobs },
    { count: totalApplications },
    { count: shortlisted },
    { count: hired },
    { count: pending },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'job_seeker'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'employer'),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_blocked', true),
    supabase.from('companies').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('is_suspicious', true),
    supabase.from('applications').select('*', { count: 'exact', head: true }),
    supabase.from('applications').select('*', { count: 'exact', head: true }).eq('status', 'shortlisted'),
    supabase.from('applications').select('*', { count: 'exact', head: true }).eq('status', 'hired'),
    supabase.from('applications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  return ApiResponse.success(res, 200, 'Admin stats fetched', {
    totalUsers: totalUsers || 0,
    jobSeekers: jobSeekers || 0,
    employers: employers || 0,
    blockedUsers: blockedUsers || 0,
    totalCompanies: totalCompanies || 0,
    totalJobs: totalJobs || 0,
    activeJobs: activeJobs || 0,
    suspiciousJobs: suspiciousJobs || 0,
    totalApplications: totalApplications || 0,
    shortlisted: shortlisted || 0,
    hired: hired || 0,
    pending: pending || 0,
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from('profiles')
    .select('id, email, full_name, role, phone, location, is_email_verified, is_blocked, blocked_reason, last_login_at, created_at', { count: 'exact' });

  if (req.query.role) q = q.eq('role', req.query.role);
  if (req.query.is_blocked === 'true') q = q.eq('is_blocked', true);
  if (req.query.is_blocked === 'false') q = q.eq('is_blocked', false);
  if (req.query.search) {
    q = q.or(`full_name.ilike.%${req.query.search}%,email.ilike.%${req.query.search}%`);
  }

  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return ApiResponse.paginated(res, data || [], page, limit, count || 0, 'Users fetched');
});

const blockUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) throw new AppError('You cannot block yourself.', 400);

  const { data: user, error } = await supabase
    .from('profiles')
    .update({
      is_blocked: true,
      blocked_reason: req.body.reason || 'Violated platform policies',
    })
    .eq('id', id)
    .select('id, email, full_name, role, is_blocked, blocked_reason')
    .single();

  if (error || !user) throw new AppError('User not found.', 404);

  // Revoke tokens
  await supabase
    .from('refresh_tokens')
    .update({ revoked: true, revoked_at: new Date().toISOString() })
    .eq('user_id', id)
    .eq('revoked', false);

  return ApiResponse.success(res, 200, 'User blocked', user);
});

const unblockUser = asyncHandler(async (req, res) => {
  const { data: user, error } = await supabase
    .from('profiles')
    .update({ is_blocked: false, blocked_reason: null })
    .eq('id', req.params.id)
    .select('id, email, full_name, role, is_blocked, blocked_reason')
    .single();

  if (error || !user) throw new AppError('User not found.', 404);
  return ApiResponse.success(res, 200, 'User unblocked', user);
});

const listCompanies = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from('companies')
    .select('*, employer:employer_id (id, full_name, email, is_blocked)', { count: 'exact' });

  if (req.query.search) q = q.ilike('name', `%${req.query.search}%`);
  if (req.query.is_active === 'true') q = q.eq('is_active', true);
  if (req.query.is_active === 'false') q = q.eq('is_active', false);

  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return ApiResponse.paginated(res, data || [], page, limit, count || 0, 'Companies fetched');
});

const toggleCompany = asyncHandler(async (req, res) => {
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!company) throw new AppError('Company not found.', 404);

  const { data, error } = await supabase
    .from('companies')
    .update({ is_active: !company.is_active })
    .eq('id', company.id)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, `Company ${data.is_active ? 'activated' : 'deactivated'}`, data);
});

const listJobs = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from('jobs')
    .select(
      '*, companies:company_id (id, name), employer:employer_id (id, full_name, email)',
      { count: 'exact' }
    );

  if (req.query.status) q = q.eq('status', req.query.status);
  if (req.query.is_suspicious === 'true') q = q.eq('is_suspicious', true);
  if (req.query.search) q = q.ilike('title', `%${req.query.search}%`);

  q = q.order('created_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return ApiResponse.paginated(res, data || [], page, limit, count || 0, 'Jobs fetched');
});

const flagJob = asyncHandler(async (req, res) => {
  const { data: job, error } = await supabase
    .from('jobs')
    .update({
      is_suspicious: true,
      suspicious_reason: req.body.reason || 'Flagged by admin',
      status: 'flagged',
    })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error || !job) throw new AppError('Job not found.', 404);
  return ApiResponse.success(res, 200, 'Job flagged as suspicious', job);
});

const unflagJob = asyncHandler(async (req, res) => {
  const { data: job, error } = await supabase
    .from('jobs')
    .update({
      is_suspicious: false,
      suspicious_reason: null,
      status: 'open',
    })
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error || !job) throw new AppError('Job not found.', 404);
  return ApiResponse.success(res, 200, 'Job unflagged', job);
});

const deleteJob = asyncHandler(async (req, res) => {
  const { error } = await supabase.from('jobs').delete().eq('id', req.params.id);
  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, 'Job deleted');
});

const listApplications = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from('applications')
    .select(
      `
      *,
      jobs:job_id (id, title),
      applicant:applicant_id (id, full_name, email)
    `,
      { count: 'exact' }
    );

  if (req.query.status) q = q.eq('status', req.query.status);

  q = q.order('applied_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return ApiResponse.paginated(res, data || [], page, limit, count || 0, 'Applications fetched');
});

const createAdmin = asyncHandler(async (req, res) => {
  const { email, password, full_name } = req.body;
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) throw new AppError('Email already in use.', 409);

  const password_hash = await hashPassword(password);
  const { data: user, error } = await supabase
    .from('profiles')
    .insert({
      email: email.toLowerCase(),
      password_hash,
      full_name,
      role: 'admin',
      is_email_verified: true,
    })
    .select('id, email, full_name, role, created_at')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 201, 'Admin created', user);
});

module.exports = {
  getStats,
  listUsers,
  blockUser,
  unblockUser,
  listCompanies,
  toggleCompany,
  listJobs,
  flagJob,
  unflagJob,
  deleteJob,
  listApplications,
  createAdmin,
};
