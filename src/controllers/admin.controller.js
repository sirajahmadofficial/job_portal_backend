const { query } = require('../config/database');
const { ApiResponse, AppError } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');
const { hashPassword } = require('../utils/generateToken');

const count = async (sql, params = []) => {
  const { rows } = await query(sql, params);
  return rows[0].c;
};

const getStats = asyncHandler(async (req, res) => {
  const [
    totalUsers, jobSeekers, employers, blockedUsers, totalCompanies,
    totalJobs, activeJobs, suspiciousJobs, totalApplications, shortlisted, hired, pending,
  ] = await Promise.all([
    count('SELECT COUNT(*)::int AS c FROM users'),
    count(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'job_seeker'`),
    count(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'employer'`),
    count(`SELECT COUNT(*)::int AS c FROM users WHERE is_blocked = true`),
    count('SELECT COUNT(*)::int AS c FROM companies'),
    count('SELECT COUNT(*)::int AS c FROM jobs'),
    count(`SELECT COUNT(*)::int AS c FROM jobs WHERE status = 'open'`),
    count(`SELECT COUNT(*)::int AS c FROM jobs WHERE is_suspicious = true`),
    count('SELECT COUNT(*)::int AS c FROM applications'),
    count(`SELECT COUNT(*)::int AS c FROM applications WHERE status = 'shortlisted'`),
    count(`SELECT COUNT(*)::int AS c FROM applications WHERE status = 'hired'`),
    count(`SELECT COUNT(*)::int AS c FROM applications WHERE status = 'pending'`),
  ]);

  return ApiResponse.success(res, 200, 'Admin stats fetched', {
    totalUsers, jobSeekers, employers, blockedUsers, totalCompanies,
    totalJobs, activeJobs, suspiciousJobs, totalApplications, shortlisted, hired, pending,
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  let i = 1;
  if (req.query.role) {
    where.push(`role = $${i++}`);
    params.push(req.query.role);
  }
  if (req.query.is_blocked === 'true') where.push('is_blocked = true');
  if (req.query.is_blocked === 'false') where.push('is_blocked = false');
  if (req.query.search) {
    where.push(`(full_name ILIKE $${i} OR email ILIKE $${i})`);
    params.push(`%${req.query.search}%`);
    i++;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await count(`SELECT COUNT(*)::int AS c FROM users ${whereSql}`, params);
  const { rows } = await query(
    `SELECT id, email, full_name, role, phone, location, is_email_verified, is_blocked,
            blocked_reason, last_login_at, created_at
     FROM users ${whereSql}
     ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  return ApiResponse.paginated(res, rows, page, limit, total, 'Users fetched');
});

const blockUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw new AppError('You cannot block yourself.', 400);

  const { rows } = await query(
    `UPDATE users SET is_blocked = true, blocked_reason = $1
     WHERE id = $2
     RETURNING id, email, full_name, role, is_blocked, blocked_reason`,
    [req.body.reason || 'Violated platform policies', req.params.id]
  );
  if (!rows[0]) throw new AppError('User not found.', 404);

  await query(
    `UPDATE refresh_tokens SET revoked = true, revoked_at = NOW()
     WHERE user_id = $1 AND revoked = false`,
    [req.params.id]
  );

  return ApiResponse.success(res, 200, 'User blocked', rows[0]);
});

const unblockUser = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE users SET is_blocked = false, blocked_reason = NULL
     WHERE id = $1
     RETURNING id, email, full_name, role, is_blocked, blocked_reason`,
    [req.params.id]
  );
  if (!rows[0]) throw new AppError('User not found.', 404);
  return ApiResponse.success(res, 200, 'User unblocked', rows[0]);
});

const listCompanies = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  let i = 1;
  if (req.query.search) {
    where.push(`c.name ILIKE $${i++}`);
    params.push(`%${req.query.search}%`);
  }
  if (req.query.is_active === 'true') where.push('c.is_active = true');
  if (req.query.is_active === 'false') where.push('c.is_active = false');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await count(`SELECT COUNT(*)::int AS c FROM companies c ${whereSql}`, params);
  const { rows } = await query(
    `SELECT c.*, p.id AS employer_pk, p.full_name AS employer_name, p.email AS employer_email, p.is_blocked
     FROM companies c
     LEFT JOIN users p ON p.id = c.employer_id
     ${whereSql}
     ORDER BY c.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  const data = rows.map((r) => ({
    ...r,
    employer: {
      id: r.employer_pk,
      full_name: r.employer_name,
      email: r.employer_email,
      is_blocked: r.is_blocked,
    },
  }));

  return ApiResponse.paginated(res, data, page, limit, total, 'Companies fetched');
});

const toggleCompany = asyncHandler(async (req, res) => {
  const existing = await query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
  if (!existing.rows[0]) throw new AppError('Company not found.', 404);

  const { rows } = await query(
    `UPDATE companies SET is_active = NOT is_active WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  return ApiResponse.success(
    res,
    200,
    `Company ${rows[0].is_active ? 'activated' : 'deactivated'}`,
    rows[0]
  );
});

const listJobs = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  let i = 1;
  if (req.query.status) {
    where.push(`j.status = $${i++}`);
    params.push(req.query.status);
  }
  if (req.query.is_suspicious === 'true') where.push('j.is_suspicious = true');
  if (req.query.search) {
    where.push(`j.title ILIKE $${i++}`);
    params.push(`%${req.query.search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await count(`SELECT COUNT(*)::int AS c FROM jobs j ${whereSql}`, params);
  const { rows } = await query(
    `SELECT j.*, c.name AS company_name, p.full_name AS employer_name, p.email AS employer_email
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN users p ON p.id = j.employer_id
     ${whereSql}
     ORDER BY j.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  const data = rows.map((r) => ({
    ...r,
    companies: { id: r.company_id, name: r.company_name },
    employer: { id: r.employer_id, full_name: r.employer_name, email: r.employer_email },
  }));

  return ApiResponse.paginated(res, data, page, limit, total, 'Jobs fetched');
});

const flagJob = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE jobs SET is_suspicious = true, suspicious_reason = $1, status = 'flagged'
     WHERE id = $2 RETURNING *`,
    [req.body.reason || 'Flagged by admin', req.params.id]
  );
  if (!rows[0]) throw new AppError('Job not found.', 404);
  return ApiResponse.success(res, 200, 'Job flagged as suspicious', rows[0]);
});

const unflagJob = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE jobs SET is_suspicious = false, suspicious_reason = NULL, status = 'open'
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) throw new AppError('Job not found.', 404);
  return ApiResponse.success(res, 200, 'Job unflagged', rows[0]);
});

const deleteJob = asyncHandler(async (req, res) => {
  await query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
  return ApiResponse.success(res, 200, 'Job deleted');
});

const listApplications = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  let i = 1;
  if (req.query.status) {
    where.push(`a.status = $${i++}`);
    params.push(req.query.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await count(`SELECT COUNT(*)::int AS c FROM applications a ${whereSql}`, params);
  const { rows } = await query(
    `SELECT a.*, j.title AS job_title, p.full_name AS applicant_name, p.email AS applicant_email
     FROM applications a
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN users p ON p.id = a.applicant_id
     ${whereSql}
     ORDER BY a.applied_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );

  const data = rows.map((r) => ({
    ...r,
    jobs: { id: r.job_id, title: r.job_title },
    applicant: { id: r.applicant_id, full_name: r.applicant_name, email: r.applicant_email },
  }));

  return ApiResponse.paginated(res, data, page, limit, total, 'Applications fetched');
});

const createAdmin = asyncHandler(async (req, res) => {
  const { email, password, full_name } = req.body;
  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows[0]) throw new AppError('Email already in use.', 409);

  const password_hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role, is_email_verified)
     VALUES ($1, $2, $3, 'admin', true)
     RETURNING id, email, full_name, role, created_at`,
    [email.toLowerCase(), password_hash, full_name]
  );
  return ApiResponse.success(res, 201, 'Admin created', rows[0]);
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
