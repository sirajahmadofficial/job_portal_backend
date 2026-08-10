const { query } = require('../config/database');
const { AppError } = require('../utils/apiResponse');

const mapJob = (row) => {
  if (!row) return null;
  return {
    ...row,
    companies: row.company_id
      ? {
          id: row.company_id,
          name: row.company_name,
          logo_url: row.company_logo_url,
          location: row.company_location,
          industry: row.company_industry,
          description: row.company_description,
          website: row.company_website,
          company_size: row.company_size,
        }
      : null,
    employer: row.employer_id
      ? {
          id: row.employer_id,
          full_name: row.employer_name,
          email: row.employer_email,
        }
      : null,
  };
};

const listJobs = async (filters = {}, userId = null) => {
  const {
    page = 1,
    limit = 10,
    search = '',
    category = '',
    location = '',
    job_type = '',
    status = 'open',
    sort = 'created_at',
    order = 'desc',
    employer_id = '',
    min_salary = '',
    experience_level = '',
  } = filters;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  const where = [];
  const params = [];
  let i = 1;

  if (status) {
    where.push(`j.status = $${i++}`);
    params.push(status);
  }
  if (category) {
    where.push(`j.category ILIKE $${i++}`);
    params.push(`%${category}%`);
  }
  if (location) {
    where.push(`j.location ILIKE $${i++}`);
    params.push(`%${location}%`);
  }
  if (job_type) {
    where.push(`j.job_type = $${i++}`);
    params.push(job_type);
  }
  if (employer_id) {
    where.push(`j.employer_id = $${i++}`);
    params.push(employer_id);
  } else {
    where.push('j.is_suspicious = false');
  }
  if (experience_level) {
    where.push(`j.experience_level = $${i++}`);
    params.push(experience_level);
  }
  if (min_salary) {
    where.push(`j.salary_min >= $${i++}`);
    params.push(Number(min_salary));
  }
  if (search) {
    where.push(`(j.title ILIKE $${i} OR j.description ILIKE $${i} OR j.category ILIKE $${i})`);
    params.push(`%${search}%`);
    i++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const allowedSort = ['created_at', 'title', 'salary_min', 'applications_count', 'views_count'];
  const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM jobs j ${whereSql}`,
    params
  );
  const total = countRes.rows[0].total;

  const dataRes = await query(
    `SELECT j.*,
            c.name AS company_name, c.logo_url AS company_logo_url,
            c.location AS company_location, c.industry AS company_industry,
            p.full_name AS employer_name
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN profiles p ON p.id = j.employer_id
     ${whereSql}
     ORDER BY j.${sortCol} ${sortDir}
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limitNum, offset]
  );

  let savedSet = new Set();
  if (userId && dataRes.rows.length) {
    const ids = dataRes.rows.map((r) => r.id);
    const savedRes = await query(
      `SELECT job_id FROM saved_jobs WHERE user_id = $1 AND job_id = ANY($2::uuid[])`,
      [userId, ids]
    );
    savedSet = new Set(savedRes.rows.map((s) => s.job_id));
  }

  const jobs = dataRes.rows.map((row) => ({
    ...mapJob(row),
    is_saved: savedSet.has(row.id),
  }));

  return { jobs, page: pageNum, limit: limitNum, total };
};

const getJobById = async (jobId, userId = null) => {
  const { rows } = await query(
    `SELECT j.*,
            c.name AS company_name, c.logo_url AS company_logo_url,
            c.location AS company_location, c.industry AS company_industry,
            c.description AS company_description, c.website AS company_website,
            c.company_size,
            p.full_name AS employer_name, p.email AS employer_email
     FROM jobs j
     LEFT JOIN companies c ON c.id = j.company_id
     LEFT JOIN profiles p ON p.id = j.employer_id
     WHERE j.id = $1`,
    [jobId]
  );
  if (!rows[0]) throw new AppError('Job not found.', 404);

  await query('UPDATE jobs SET views_count = views_count + 1 WHERE id = $1', [jobId]);

  let is_saved = false;
  let has_applied = false;
  if (userId) {
    const saved = await query(
      'SELECT id FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
      [userId, jobId]
    );
    const app = await query(
      'SELECT id FROM applications WHERE applicant_id = $1 AND job_id = $2 AND withdrawn_at IS NULL',
      [userId, jobId]
    );
    is_saved = !!saved.rows[0];
    has_applied = !!app.rows[0];
  }

  return { ...mapJob(rows[0]), is_saved, has_applied };
};

const createJob = async (employerId, payload) => {
  const companyRes = await query('SELECT * FROM companies WHERE employer_id = $1', [employerId]);
  const company = companyRes.rows[0];
  if (!company) throw new AppError('Please create a company profile before posting jobs.', 400);
  if (!company.is_active) throw new AppError('Your company is inactive. Contact support.', 403);

  const { rows } = await query(
    `INSERT INTO jobs (
      company_id, employer_id, title, description, requirements, responsibilities,
      category, location, job_type, salary_min, salary_max, salary_currency,
      experience_level, status, closes_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,
    [
      company.id,
      employerId,
      payload.title,
      payload.description,
      payload.requirements || null,
      payload.responsibilities || null,
      payload.category,
      payload.location,
      payload.job_type || 'full_time',
      payload.salary_min || null,
      payload.salary_max || null,
      payload.salary_currency || 'USD',
      payload.experience_level || null,
      payload.status || 'open',
      payload.closes_at || null,
    ]
  );
  return rows[0];
};

const updateJob = async (jobId, employerId, payload, isAdmin = false) => {
  const existingRes = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const existing = existingRes.rows[0];
  if (!existing) throw new AppError('Job not found.', 404);
  if (!isAdmin && existing.employer_id !== employerId) {
    throw new AppError('You can only update your own jobs.', 403);
  }

  const allowed = [
    'title', 'description', 'requirements', 'responsibilities', 'category',
    'location', 'job_type', 'salary_min', 'salary_max', 'salary_currency',
    'experience_level', 'status', 'closes_at',
  ];

  const sets = [];
  const params = [];
  let i = 1;
  allowed.forEach((key) => {
    if (payload[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      params.push(payload[key]);
    }
  });
  if (!sets.length) return existing;

  params.push(jobId);
  const { rows } = await query(
    `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  return rows[0];
};

const deleteJob = async (jobId, employerId, isAdmin = false) => {
  const existingRes = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const existing = existingRes.rows[0];
  if (!existing) throw new AppError('Job not found.', 404);
  if (!isAdmin && existing.employer_id !== employerId) {
    throw new AppError('You can only delete your own jobs.', 403);
  }
  await query('DELETE FROM jobs WHERE id = $1', [jobId]);
  return { message: 'Job deleted successfully.' };
};

const setJobStatus = async (jobId, employerId, status) => {
  if (!['open', 'closed', 'draft'].includes(status)) {
    throw new AppError('Invalid status. Use open, closed, or draft.', 400);
  }
  return updateJob(jobId, employerId, { status });
};

const getEmployerJobs = async (employerId, filters = {}) => {
  return listJobs({ ...filters, employer_id: employerId, status: filters.status || '' }, employerId);
};

const getCategories = async () => {
  const { rows } = await query(
    `SELECT category AS name, COUNT(*)::int AS count
     FROM jobs WHERE status = 'open'
     GROUP BY category ORDER BY count DESC`
  );
  return rows;
};

const saveJob = async (userId, jobId) => {
  const job = await query('SELECT id FROM jobs WHERE id = $1', [jobId]);
  if (!job.rows[0]) throw new AppError('Job not found.', 404);

  const existing = await query(
    'SELECT id FROM saved_jobs WHERE user_id = $1 AND job_id = $2',
    [userId, jobId]
  );
  if (existing.rows[0]) throw new AppError('Job already saved.', 409);

  const { rows } = await query(
    'INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2) RETURNING *',
    [userId, jobId]
  );
  return rows[0];
};

const unsaveJob = async (userId, jobId) => {
  await query('DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2', [userId, jobId]);
  return { message: 'Job removed from saved list.' };
};

const getSavedJobs = async (userId, filters = {}) => {
  const pageNum = Math.max(1, parseInt(filters.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(filters.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  const countRes = await query(
    'SELECT COUNT(*)::int AS total FROM saved_jobs WHERE user_id = $1',
    [userId]
  );

  const { rows } = await query(
    `SELECT s.id AS saved_id, s.created_at AS saved_at, j.*,
            c.name AS company_name, c.logo_url AS company_logo_url, c.location AS company_location
     FROM saved_jobs s
     JOIN jobs j ON j.id = s.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limitNum, offset]
  );

  return {
    jobs: rows.map((row) => ({
      ...mapJob(row),
      saved_id: row.saved_id,
      saved_at: row.saved_at,
      is_saved: true,
    })),
    page: pageNum,
    limit: limitNum,
    total: countRes.rows[0].total,
  };
};

module.exports = {
  listJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  setJobStatus,
  getEmployerJobs,
  getCategories,
  saveJob,
  unsaveJob,
  getSavedJobs,
};
