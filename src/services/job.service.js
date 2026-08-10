const { supabase } = require('../config/database');
const { AppError } = require('../utils/apiResponse');

const listJobs = async (query = {}, userId = null) => {
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
  } = query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let q = supabase
    .from('jobs')
    .select(
      `
      *,
      companies:company_id (id, name, logo_url, location, industry),
      employer:employer_id (id, full_name)
    `,
      { count: 'exact' }
    );

  if (status) q = q.eq('status', status);
  if (category) q = q.ilike('category', `%${category}%`);
  if (location) q = q.ilike('location', `%${location}%`);
  if (job_type) q = q.eq('job_type', job_type);
  if (employer_id) q = q.eq('employer_id', employer_id);
  if (experience_level) q = q.eq('experience_level', experience_level);
  if (min_salary) q = q.gte('salary_min', Number(min_salary));
  if (search) {
    q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`);
  }

  // Hide suspicious from public listings unless employer viewing own
  if (!employer_id) {
    q = q.eq('is_suspicious', false);
  }

  const allowedSort = ['created_at', 'title', 'salary_min', 'applications_count', 'views_count'];
  const sortCol = allowedSort.includes(sort) ? sort : 'created_at';
  const ascending = order === 'asc';

  q = q.order(sortCol, { ascending }).range(from, to);

  const { data, error, count } = await q;
  if (error) throw new AppError(error.message, 500);

  let savedSet = new Set();
  if (userId && data?.length) {
    const jobIds = data.map((j) => j.id);
    const { data: saved } = await supabase
      .from('saved_jobs')
      .select('job_id')
      .eq('user_id', userId)
      .in('job_id', jobIds);
    savedSet = new Set((saved || []).map((s) => s.job_id));
  }

  const jobs = (data || []).map((job) => ({
    ...job,
    is_saved: savedSet.has(job.id),
  }));

  return { jobs, page: pageNum, limit: limitNum, total: count || 0 };
};

const getJobById = async (jobId, userId = null) => {
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      `
      *,
      companies:company_id (*),
      employer:employer_id (id, full_name, email)
    `
    )
    .eq('id', jobId)
    .single();

  if (error || !job) throw new AppError('Job not found.', 404);

  // Increment views (fire and forget)
  supabase
    .from('jobs')
    .update({ views_count: (job.views_count || 0) + 1 })
    .eq('id', jobId)
    .then(() => {});

  let is_saved = false;
  let has_applied = false;

  if (userId) {
    const [{ data: saved }, { data: app }] = await Promise.all([
      supabase.from('saved_jobs').select('id').eq('user_id', userId).eq('job_id', jobId).maybeSingle(),
      supabase.from('applications').select('id, status').eq('applicant_id', userId).eq('job_id', jobId).maybeSingle(),
    ]);
    is_saved = !!saved;
    has_applied = !!app;
  }

  return { ...job, is_saved, has_applied };
};

const createJob = async (employerId, payload) => {
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('employer_id', employerId)
    .maybeSingle();

  if (!company) {
    throw new AppError('Please create a company profile before posting jobs.', 400);
  }

  if (!company.is_active) {
    throw new AppError('Your company is inactive. Contact support.', 403);
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      company_id: company.id,
      employer_id: employerId,
      title: payload.title,
      description: payload.description,
      requirements: payload.requirements || null,
      responsibilities: payload.responsibilities || null,
      category: payload.category,
      location: payload.location,
      job_type: payload.job_type || 'full_time',
      salary_min: payload.salary_min || null,
      salary_max: payload.salary_max || null,
      salary_currency: payload.salary_currency || 'USD',
      experience_level: payload.experience_level || null,
      status: payload.status || 'open',
      closes_at: payload.closes_at || null,
    })
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return job;
};

const updateJob = async (jobId, employerId, payload, isAdmin = false) => {
  const { data: existing } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  if (!existing) throw new AppError('Job not found.', 404);

  if (!isAdmin && existing.employer_id !== employerId) {
    throw new AppError('You can only update your own jobs.', 403);
  }

  const allowed = [
    'title', 'description', 'requirements', 'responsibilities', 'category',
    'location', 'job_type', 'salary_min', 'salary_max', 'salary_currency',
    'experience_level', 'status', 'closes_at',
  ];

  const updates = {};
  allowed.forEach((key) => {
    if (payload[key] !== undefined) updates[key] = payload[key];
  });

  const { data: job, error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', jobId)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return job;
};

const deleteJob = async (jobId, employerId, isAdmin = false) => {
  const { data: existing } = await supabase.from('jobs').select('*').eq('id', jobId).single();
  if (!existing) throw new AppError('Job not found.', 404);

  if (!isAdmin && existing.employer_id !== employerId) {
    throw new AppError('You can only delete your own jobs.', 403);
  }

  const { error } = await supabase.from('jobs').delete().eq('id', jobId);
  if (error) throw new AppError(error.message, 500);
  return { message: 'Job deleted successfully.' };
};

const setJobStatus = async (jobId, employerId, status) => {
  if (!['open', 'closed', 'draft'].includes(status)) {
    throw new AppError('Invalid status. Use open, closed, or draft.', 400);
  }
  return updateJob(jobId, employerId, { status });
};

const getEmployerJobs = async (employerId, query = {}) => {
  return listJobs({ ...query, employer_id: employerId, status: query.status || '' }, employerId);
};

const getCategories = async () => {
  const { data, error } = await supabase
    .from('jobs')
    .select('category')
    .eq('status', 'open');

  if (error) throw new AppError(error.message, 500);

  const counts = {};
  (data || []).forEach((row) => {
    counts[row.category] = (counts[row.category] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
};

const saveJob = async (userId, jobId) => {
  const { data: job } = await supabase.from('jobs').select('id').eq('id', jobId).single();
  if (!job) throw new AppError('Job not found.', 404);

  const { data: existing } = await supabase
    .from('saved_jobs')
    .select('id')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (existing) throw new AppError('Job already saved.', 409);

  const { data, error } = await supabase
    .from('saved_jobs')
    .insert({ user_id: userId, job_id: jobId })
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return data;
};

const unsaveJob = async (userId, jobId) => {
  const { error } = await supabase
    .from('saved_jobs')
    .delete()
    .eq('user_id', userId)
    .eq('job_id', jobId);

  if (error) throw new AppError(error.message, 500);
  return { message: 'Job removed from saved list.' };
};

const getSavedJobs = async (userId, query = {}) => {
  const pageNum = Math.max(1, parseInt(query.page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 10));
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  const { data, error, count } = await supabase
    .from('saved_jobs')
    .select(
      `
      id, created_at,
      jobs:job_id (
        *,
        companies:company_id (id, name, logo_url, location)
      )
    `,
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw new AppError(error.message, 500);

  return {
    jobs: (data || []).map((s) => ({ ...s.jobs, saved_id: s.id, saved_at: s.created_at, is_saved: true })),
    page: pageNum,
    limit: limitNum,
    total: count || 0,
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
