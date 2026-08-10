const { query } = require('../config/database');
const { AppError } = require('../utils/apiResponse');
const emailService = require('./email.service');
const storageService = require('./storage.service');

const STATUS_FLOW = ['pending', 'reviewing', 'shortlisted', 'rejected', 'hired'];

const applyToJob = async (applicantId, jobId, { cover_letter, resume_url, resume_path }) => {
  const jobRes = await query(
    `SELECT j.*, c.id AS company_pk, c.name AS company_name,
            e.id AS employer_pk, e.email AS employer_email, e.full_name AS employer_name
     FROM jobs j
     JOIN companies c ON c.id = j.company_id
     JOIN profiles e ON e.id = j.employer_id
     WHERE j.id = $1`,
    [jobId]
  );
  const job = jobRes.rows[0];
  if (!job) throw new AppError('Job not found.', 404);
  if (job.status !== 'open') throw new AppError('This job is not accepting applications.', 400);

  const applicantRes = await query('SELECT * FROM profiles WHERE id = $1', [applicantId]);
  const applicant = applicantRes.rows[0];
  if (!applicant) throw new AppError('Applicant not found.', 404);

  const finalResumeUrl = resume_url || applicant.resume_url;
  const finalResumePath = resume_path || applicant.resume_path;
  if (!finalResumeUrl) throw new AppError('Please upload a resume before applying.', 400);

  const existingRes = await query(
    'SELECT * FROM applications WHERE job_id = $1 AND applicant_id = $2',
    [jobId, applicantId]
  );
  const existing = existingRes.rows[0];
  if (existing && !existing.withdrawn_at) {
    throw new AppError('You have already applied to this job.', 409);
  }

  let application;
  if (existing && existing.withdrawn_at) {
    const { rows } = await query(
      `UPDATE applications SET
        cover_letter = $1, resume_url = $2, resume_path = $3, status = 'pending',
        withdrawn_at = NULL, applied_at = NOW(), status_updated_at = NULL, employer_notes = NULL
       WHERE id = $4 RETURNING *`,
      [cover_letter || null, finalResumeUrl, finalResumePath, existing.id]
    );
    application = rows[0];
  } else {
    const { rows } = await query(
      `INSERT INTO applications (job_id, applicant_id, cover_letter, resume_url, resume_path, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [jobId, applicantId, cover_letter || null, finalResumeUrl, finalResumePath]
    );
    application = rows[0];
  }

  const company = { name: job.company_name };
  const employer = {
    id: job.employer_pk,
    email: job.employer_email,
    full_name: job.employer_name,
  };

  try {
    await emailService.sendApplicationSubmittedEmail(applicant, job, company);
    await emailService.sendNewApplicantNotificationEmail(employer, applicant, job, company);
  } catch (err) {
    console.error('Application email error:', err.message);
  }

  return application;
};

const withdrawApplication = async (applicationId, applicantId) => {
  const { rows } = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
  const app = rows[0];
  if (!app) throw new AppError('Application not found.', 404);
  if (app.applicant_id !== applicantId) {
    throw new AppError('You can only withdraw your own applications.', 403);
  }
  if (app.withdrawn_at) throw new AppError('Application already withdrawn.', 400);
  if (['hired', 'rejected'].includes(app.status)) {
    throw new AppError('Cannot withdraw an application that is already finalized.', 400);
  }

  const updated = await query(
    `UPDATE applications
     SET withdrawn_at = NOW(), status = 'rejected', status_updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [applicationId]
  );
  return updated.rows[0];
};

const getMyApplications = async (applicantId, filters = {}) => {
  const pageNum = Math.max(1, parseInt(filters.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(filters.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  const where = ['a.applicant_id = $1'];
  const params = [applicantId];
  let i = 2;

  if (filters.include_withdrawn !== 'true') where.push('a.withdrawn_at IS NULL');
  if (filters.status) {
    where.push(`a.status = $${i++}`);
    params.push(filters.status);
  }

  const whereSql = where.join(' AND ');
  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM applications a WHERE ${whereSql}`,
    params
  );

  const { rows } = await query(
    `SELECT a.*,
            j.id AS job_pk, j.title AS job_title, j.location AS job_location,
            j.job_type, j.status AS job_status, j.category,
            c.id AS company_pk, c.name AS company_name, c.logo_url AS company_logo_url
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     WHERE ${whereSql}
     ORDER BY a.applied_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limitNum, offset]
  );

  return {
    applications: rows.map((r) => ({
      ...r,
      jobs: {
        id: r.job_pk,
        title: r.job_title,
        location: r.job_location,
        job_type: r.job_type,
        status: r.job_status,
        category: r.category,
        companies: {
          id: r.company_pk,
          name: r.company_name,
          logo_url: r.company_logo_url,
        },
      },
    })),
    page: pageNum,
    limit: limitNum,
    total: countRes.rows[0].total,
  };
};

const getJobApplicants = async (jobId, employerId, filters = {}, isAdmin = false) => {
  const jobRes = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = jobRes.rows[0];
  if (!job) throw new AppError('Job not found.', 404);
  if (!isAdmin && job.employer_id !== employerId) {
    throw new AppError('You can only view applicants for your own jobs.', 403);
  }

  const pageNum = Math.max(1, parseInt(filters.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(filters.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  const where = ['a.job_id = $1', 'a.withdrawn_at IS NULL'];
  const params = [jobId];
  let i = 2;
  if (filters.status) {
    where.push(`a.status = $${i++}`);
    params.push(filters.status);
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM applications a WHERE ${where.join(' AND ')}`,
    params
  );

  const { rows } = await query(
    `SELECT a.*,
            p.id AS applicant_pk, p.full_name, p.email, p.phone, p.location,
            p.headline, p.bio, p.skills, p.experience_years, p.education,
            p.resume_url AS applicant_resume_url, p.avatar_url, p.linkedin_url
     FROM applications a
     JOIN profiles p ON p.id = a.applicant_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.applied_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limitNum, offset]
  );

  return {
    applications: rows.map((r) => ({
      ...r,
      applicant: {
        id: r.applicant_pk,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        location: r.location,
        headline: r.headline,
        bio: r.bio,
        skills: r.skills,
        experience_years: r.experience_years,
        education: r.education,
        resume_url: r.applicant_resume_url,
        avatar_url: r.avatar_url,
        linkedin_url: r.linkedin_url,
      },
    })),
    job,
    page: pageNum,
    limit: limitNum,
    total: countRes.rows[0].total,
  };
};

const getEmployerApplications = async (employerId, filters = {}) => {
  const pageNum = Math.max(1, parseInt(filters.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(filters.limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  const jobsRes = await query('SELECT id FROM jobs WHERE employer_id = $1', [employerId]);
  const jobIds = jobsRes.rows.map((j) => j.id);
  if (!jobIds.length) {
    return { applications: [], page: pageNum, limit: limitNum, total: 0 };
  }

  const where = ['a.job_id = ANY($1::uuid[])', 'a.withdrawn_at IS NULL'];
  const params = [jobIds];
  let i = 2;
  if (filters.status) {
    where.push(`a.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.job_id) {
    where.push(`a.job_id = $${i++}`);
    params.push(filters.job_id);
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM applications a WHERE ${where.join(' AND ')}`,
    params
  );

  const { rows } = await query(
    `SELECT a.*,
            j.id AS job_pk, j.title AS job_title, j.location AS job_location, j.status AS job_status,
            p.id AS applicant_pk, p.full_name, p.email, p.phone, p.location AS applicant_location,
            p.headline, p.skills, p.experience_years, p.resume_url AS applicant_resume_url, p.avatar_url
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     JOIN profiles p ON p.id = a.applicant_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.applied_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limitNum, offset]
  );

  return {
    applications: rows.map((r) => ({
      ...r,
      jobs: {
        id: r.job_pk,
        title: r.job_title,
        location: r.job_location,
        status: r.job_status,
      },
      applicant: {
        id: r.applicant_pk,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        location: r.applicant_location,
        headline: r.headline,
        skills: r.skills,
        experience_years: r.experience_years,
        resume_url: r.applicant_resume_url,
        avatar_url: r.avatar_url,
      },
    })),
    page: pageNum,
    limit: limitNum,
    total: countRes.rows[0].total,
  };
};

const getApplicationById = async (applicationId, userId, role) => {
  const { rows } = await query(
    `SELECT a.*,
            j.*, j.id AS job_pk, j.employer_id AS job_employer_id, j.title AS job_title,
            c.id AS company_pk, c.name AS company_name,
            p.id AS applicant_pk, p.full_name, p.email, p.phone, p.location,
            p.headline, p.bio, p.skills, p.experience_years, p.education,
            p.resume_url AS applicant_resume_url, p.avatar_url, p.linkedin_url, p.website
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN companies c ON c.id = j.company_id
     JOIN profiles p ON p.id = a.applicant_id
     WHERE a.id = $1`,
    [applicationId]
  );
  const app = rows[0];
  if (!app) throw new AppError('Application not found.', 404);

  const isOwner = app.applicant_id === userId;
  const isJobOwner = app.job_employer_id === userId;
  const isAdmin = role === 'admin';
  if (!isOwner && !isJobOwner && !isAdmin) throw new AppError('Access denied.', 403);

  return {
    ...app,
    jobs: {
      id: app.job_pk,
      title: app.job_title,
      employer_id: app.job_employer_id,
      companies: { id: app.company_pk, name: app.company_name },
    },
    applicant: {
      id: app.applicant_pk,
      full_name: app.full_name,
      email: app.email,
      phone: app.phone,
      location: app.location,
      headline: app.headline,
      bio: app.bio,
      skills: app.skills,
      experience_years: app.experience_years,
      education: app.education,
      resume_url: app.applicant_resume_url,
      avatar_url: app.avatar_url,
      linkedin_url: app.linkedin_url,
      website: app.website,
    },
  };
};

const updateApplicationStatus = async (applicationId, employerId, status, notes, isAdmin = false) => {
  if (!STATUS_FLOW.includes(status)) {
    throw new AppError(`Invalid status. Allowed: ${STATUS_FLOW.join(', ')}`, 400);
  }

  const app = await getApplicationById(applicationId, employerId, isAdmin ? 'admin' : 'employer');
  if (app.withdrawn_at) throw new AppError('Application has been withdrawn.', 400);

  const { rows } = await query(
    `UPDATE applications
     SET status = $1, status_updated_at = NOW(), employer_notes = COALESCE($2, employer_notes)
     WHERE id = $3 RETURNING *`,
    [status, notes !== undefined ? notes : null, applicationId]
  );

  if (status !== 'pending') {
    try {
      await emailService.sendStatusUpdateEmail(
        app.applicant,
        app.jobs,
        app.jobs.companies,
        status
      );
    } catch (err) {
      console.error('Status email error:', err.message);
    }
  }

  return rows[0];
};

const getResumeSignedUrl = async (applicationId, userId, role) => {
  const app = await getApplicationById(applicationId, userId, role);
  if (!app.resume_path && !app.resume_url) {
    throw new AppError('No resume available for this application.', 404);
  }

  if (app.resume_path) {
    const url = await storageService.getSignedUrl('resumes', app.resume_path);
    return { url, expiresIn: null };
  }
  return { url: app.resume_url, expiresIn: null };
};

module.exports = {
  applyToJob,
  withdrawApplication,
  getMyApplications,
  getJobApplicants,
  getEmployerApplications,
  updateApplicationStatus,
  getApplicationById,
  getResumeSignedUrl,
  STATUS_FLOW,
};
