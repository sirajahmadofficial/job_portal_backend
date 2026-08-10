const { supabase } = require('../config/database');
const { AppError } = require('../utils/apiResponse');
const emailService = require('./email.service');

const STATUS_FLOW = ['pending', 'reviewing', 'shortlisted', 'rejected', 'hired'];

const applyToJob = async (applicantId, jobId, { cover_letter, resume_url, resume_path }) => {
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('*, companies:company_id (*), employer:employer_id (id, email, full_name)')
    .eq('id', jobId)
    .single();

  if (jobError || !job) throw new AppError('Job not found.', 404);
  if (job.status !== 'open') throw new AppError('This job is not accepting applications.', 400);

  const { data: applicant } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', applicantId)
    .single();

  if (!applicant) throw new AppError('Applicant not found.', 404);

  const finalResumeUrl = resume_url || applicant.resume_url;
  const finalResumePath = resume_path || applicant.resume_path;

  if (!finalResumeUrl) {
    throw new AppError('Please upload a resume before applying.', 400);
  }

  const { data: existing } = await supabase
    .from('applications')
    .select('id, withdrawn_at')
    .eq('job_id', jobId)
    .eq('applicant_id', applicantId)
    .maybeSingle();

  if (existing && !existing.withdrawn_at) {
    throw new AppError('You have already applied to this job.', 409);
  }

  let application;
  if (existing && existing.withdrawn_at) {
    const { data, error } = await supabase
      .from('applications')
      .update({
        cover_letter: cover_letter || null,
        resume_url: finalResumeUrl,
        resume_path: finalResumePath,
        status: 'pending',
        withdrawn_at: null,
        applied_at: new Date().toISOString(),
        status_updated_at: null,
        employer_notes: null,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new AppError(error.message, 500);
    application = data;
  } else {
    const { data, error } = await supabase
      .from('applications')
      .insert({
        job_id: jobId,
        applicant_id: applicantId,
        cover_letter: cover_letter || null,
        resume_url: finalResumeUrl,
        resume_path: finalResumePath,
        status: 'pending',
      })
      .select('*')
      .single();
    if (error) throw new AppError(error.message, 500);
    application = data;
  }

  // Send emails (non-blocking failures)
  try {
    await emailService.sendApplicationSubmittedEmail(applicant, job, job.companies);
    if (job.employer) {
      await emailService.sendNewApplicantNotificationEmail(
        job.employer,
        applicant,
        job,
        job.companies
      );
    }
  } catch (err) {
    console.error('Application email error:', err.message);
  }

  return application;
};

const withdrawApplication = async (applicationId, applicantId) => {
  const { data: app } = await supabase
    .from('applications')
    .select('*')
    .eq('id', applicationId)
    .single();

  if (!app) throw new AppError('Application not found.', 404);
  if (app.applicant_id !== applicantId) {
    throw new AppError('You can only withdraw your own applications.', 403);
  }
  if (app.withdrawn_at) throw new AppError('Application already withdrawn.', 400);
  if (['hired', 'rejected'].includes(app.status)) {
    throw new AppError('Cannot withdraw an application that is already finalized.', 400);
  }

  const { data, error } = await supabase
    .from('applications')
    .update({
      withdrawn_at: new Date().toISOString(),
      status: 'rejected',
      status_updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
};

const getMyApplications = async (applicantId, query = {}) => {
  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let q = supabase
    .from('applications')
    .select(
      `
      *,
      jobs:job_id (
        id, title, location, job_type, status, category,
        companies:company_id (id, name, logo_url)
      )
    `,
      { count: 'exact' }
    )
    .eq('applicant_id', applicantId);

  if (query.include_withdrawn !== 'true') {
    q = q.is('withdrawn_at', null);
  }
  if (query.status) q = q.eq('status', query.status);

  q = q.order('applied_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return { applications: data || [], page: pageNum, limit: limitNum, total: count || 0 };
};

const getJobApplicants = async (jobId, employerId, query = {}, isAdmin = false) => {
  const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  if (!job) throw new AppError('Job not found.', 404);
  if (!isAdmin && job.employer_id !== employerId) {
    throw new AppError('You can only view applicants for your own jobs.', 403);
  }

  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let q = supabase
    .from('applications')
    .select(
      `
      *,
      applicant:applicant_id (
        id, full_name, email, phone, location, headline, bio, skills,
        experience_years, education, resume_url, avatar_url, linkedin_url
      )
    `,
      { count: 'exact' }
    )
    .eq('job_id', jobId)
    .is('withdrawn_at', null);

  if (query.status) q = q.eq('status', query.status);

  q = q.order('applied_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return { applications: data || [], job, page: pageNum, limit: limitNum, total: count || 0 };
};

const getEmployerApplications = async (employerId, query = {}) => {
  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  // Get employer's job ids
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('employer_id', employerId);

  const jobIds = (jobs || []).map((j) => j.id);
  if (!jobIds.length) {
    return { applications: [], page: pageNum, limit: limitNum, total: 0 };
  }

  let q = supabase
    .from('applications')
    .select(
      `
      *,
      jobs:job_id (id, title, location, status),
      applicant:applicant_id (
        id, full_name, email, phone, location, headline, skills,
        experience_years, resume_url, avatar_url
      )
    `,
      { count: 'exact' }
    )
    .in('job_id', jobIds)
    .is('withdrawn_at', null);

  if (query.status) q = q.eq('status', query.status);
  if (query.job_id) q = q.eq('job_id', query.job_id);

  q = q.order('applied_at', { ascending: false }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  return { applications: data || [], page: pageNum, limit: limitNum, total: count || 0 };
};

const updateApplicationStatus = async (applicationId, employerId, status, notes, isAdmin = false) => {
  if (!STATUS_FLOW.includes(status)) {
    throw new AppError(`Invalid status. Allowed: ${STATUS_FLOW.join(', ')}`, 400);
  }

  const { data: app } = await supabase
    .from('applications')
    .select('*, jobs:job_id (*, companies:company_id (*)), applicant:applicant_id (*)')
    .eq('id', applicationId)
    .single();

  if (!app) throw new AppError('Application not found.', 404);
  if (!isAdmin && app.jobs.employer_id !== employerId) {
    throw new AppError('You can only update applications for your own jobs.', 403);
  }
  if (app.withdrawn_at) throw new AppError('Application has been withdrawn.', 400);

  const updates = {
    status,
    status_updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) updates.employer_notes = notes;

  const { data, error } = await supabase
    .from('applications')
    .update(updates)
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);

  // Notify applicant of status changes (except pending)
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

  return data;
};

const getApplicationById = async (applicationId, userId, role) => {
  const { data: app, error } = await supabase
    .from('applications')
    .select(
      `
      *,
      jobs:job_id (*, companies:company_id (*)),
      applicant:applicant_id (
        id, full_name, email, phone, location, headline, bio, skills,
        experience_years, education, resume_url, avatar_url, linkedin_url, website
      )
    `
    )
    .eq('id', applicationId)
    .single();

  if (error || !app) throw new AppError('Application not found.', 404);

  const isOwner = app.applicant_id === userId;
  const isJobOwner = app.jobs?.employer_id === userId;
  const isAdmin = role === 'admin';

  if (!isOwner && !isJobOwner && !isAdmin) {
    throw new AppError('Access denied.', 403);
  }

  return app;
};

const getResumeSignedUrl = async (applicationId, userId, role) => {
  const app = await getApplicationById(applicationId, userId, role);

  if (!app.resume_path && !app.resume_url) {
    throw new AppError('No resume available for this application.', 404);
  }

  // If path stored in private bucket, create signed URL
  if (app.resume_path) {
    const { data, error } = await supabase.storage
      .from('resumes')
      .createSignedUrl(app.resume_path, 60 * 15); // 15 minutes

    if (error) {
      // Fallback to stored URL
      if (app.resume_url) return { url: app.resume_url, expiresIn: null };
      throw new AppError('Failed to generate resume access URL.', 500);
    }
    return { url: data.signedUrl, expiresIn: 900 };
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
