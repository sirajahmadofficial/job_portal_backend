const { query } = require('../config/database');
const { ApiResponse, AppError } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');
const storageService = require('../services/storage.service');
const { sanitizeUser } = require('../services/auth.service');

const getProfile = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new AppError('Profile not found.', 404);
  return ApiResponse.success(res, 200, 'Profile fetched', sanitizeUser(rows[0]));
});

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = [
    'full_name', 'phone', 'location', 'headline', 'bio', 'skills',
    'experience_years', 'education', 'website', 'linkedin_url', 'avatar_url',
  ];

  const sets = [];
  const params = [];
  let i = 1;

  allowed.forEach((k) => {
    if (req.body[k] !== undefined) {
      let value = req.body[k];
      if (k === 'skills' && typeof value === 'string') {
        value = value.split(',').map((s) => s.trim()).filter(Boolean);
      }
      sets.push(`${k} = $${i++}`);
      params.push(value);
    }
  });

  if (!sets.length) {
    const current = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    return ApiResponse.success(res, 200, 'Profile updated', sanitizeUser(current.rows[0]));
  }

  params.push(req.user.id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  return ApiResponse.success(res, 200, 'Profile updated', sanitizeUser(rows[0]));
});

const uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Resume file is required.', 400);

  const current = await query('SELECT resume_path FROM users WHERE id = $1', [req.user.id]);
  if (current.rows[0]?.resume_path) {
    await storageService.deleteFile('resumes', current.rows[0].resume_path);
  }

  const uploaded = await storageService.uploadFile('resumes', req.file, `user-${req.user.id}`);
  const { rows } = await query(
    `UPDATE users SET resume_path = $1, resume_url = $2 WHERE id = $3 RETURNING *`,
    [uploaded.path, uploaded.url, req.user.id]
  );
  return ApiResponse.success(res, 200, 'Resume uploaded successfully', sanitizeUser(rows[0]));
});

const getPublicProfile = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, full_name, email, phone, location, headline, bio, skills,
            experience_years, education, resume_url, avatar_url, linkedin_url, website, role, created_at
     FROM users WHERE id = $1`,
    [req.params.id]
  );
  const user = rows[0];
  if (!user) throw new AppError('Profile not found.', 404);
  if (user.role !== 'job_seeker' && req.user.role !== 'admin') {
    throw new AppError('Profile not available.', 404);
  }
  return ApiResponse.success(res, 200, 'Candidate profile fetched', user);
});

const getDashboardStats = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  let stats = {};

  if (role === 'job_seeker') {
    const [apps, pending, reviewing, shortlisted, hired, saved, openJobs] = await Promise.all([
      query(`SELECT COUNT(*)::int AS c FROM applications WHERE applicant_id = $1 AND withdrawn_at IS NULL`, [userId]),
      query(`SELECT COUNT(*)::int AS c FROM applications WHERE applicant_id = $1 AND status = 'pending' AND withdrawn_at IS NULL`, [userId]),
      query(`SELECT COUNT(*)::int AS c FROM applications WHERE applicant_id = $1 AND status = 'reviewing' AND withdrawn_at IS NULL`, [userId]),
      query(`SELECT COUNT(*)::int AS c FROM applications WHERE applicant_id = $1 AND status = 'shortlisted' AND withdrawn_at IS NULL`, [userId]),
      query(`SELECT COUNT(*)::int AS c FROM applications WHERE applicant_id = $1 AND status = 'hired' AND withdrawn_at IS NULL`, [userId]),
      query(`SELECT COUNT(*)::int AS c FROM saved_jobs WHERE user_id = $1`, [userId]),
      query(`SELECT COUNT(*)::int AS c FROM jobs WHERE status = 'open' AND is_suspicious = false`),
    ]);
    stats = {
      totalJobs: openJobs.rows[0].c,
      totalApplications: apps.rows[0].c,
      pending: pending.rows[0].c,
      reviewing: reviewing.rows[0].c,
      shortlisted: shortlisted.rows[0].c,
      hired: hired.rows[0].c,
      savedJobs: saved.rows[0].c,
    };
  } else if (role === 'employer') {
    const jobsRes = await query('SELECT id, status FROM jobs WHERE employer_id = $1', [userId]);
    const jobIds = jobsRes.rows.map((j) => j.id);
    const activeJobs = jobsRes.rows.filter((j) => j.status === 'open').length;

    let totalApplicants = 0;
    let shortlisted = 0;
    let hired = 0;
    let pending = 0;

    if (jobIds.length) {
      const [a, s, h, p] = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM applications WHERE job_id = ANY($1::uuid[]) AND withdrawn_at IS NULL`, [jobIds]),
        query(`SELECT COUNT(*)::int AS c FROM applications WHERE job_id = ANY($1::uuid[]) AND status = 'shortlisted' AND withdrawn_at IS NULL`, [jobIds]),
        query(`SELECT COUNT(*)::int AS c FROM applications WHERE job_id = ANY($1::uuid[]) AND status = 'hired' AND withdrawn_at IS NULL`, [jobIds]),
        query(`SELECT COUNT(*)::int AS c FROM applications WHERE job_id = ANY($1::uuid[]) AND status = 'pending' AND withdrawn_at IS NULL`, [jobIds]),
      ]);
      totalApplicants = a.rows[0].c;
      shortlisted = s.rows[0].c;
      hired = h.rows[0].c;
      pending = p.rows[0].c;
    }

    stats = {
      totalJobs: jobsRes.rows.length,
      activeJobs,
      totalApplicants,
      pending,
      shortlisted,
      hired,
    };
  }

  return ApiResponse.success(res, 200, 'Dashboard stats fetched', stats);
});

module.exports = {
  getProfile,
  updateProfile,
  uploadResume,
  getPublicProfile,
  getDashboardStats,
};
