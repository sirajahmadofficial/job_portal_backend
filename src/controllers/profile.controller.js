const { supabase } = require('../config/database');
const { ApiResponse, AppError } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');
const storageService = require('../services/storage.service');
const { sanitizeUser } = require('../services/auth.service');

const getProfile = asyncHandler(async (req, res) => {
  const { data: user, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error || !user) throw new AppError('Profile not found.', 404);
  return ApiResponse.success(res, 200, 'Profile fetched', sanitizeUser(user));
});

const updateProfile = asyncHandler(async (req, res) => {
  const allowed = [
    'full_name', 'phone', 'location', 'headline', 'bio', 'skills',
    'experience_years', 'education', 'website', 'linkedin_url', 'avatar_url',
  ];

  const updates = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  });

  if (updates.skills && typeof updates.skills === 'string') {
    updates.skills = updates.skills.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const { data: user, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, 'Profile updated', sanitizeUser(user));
});

const uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Resume file is required.', 400);

  const { data: profile } = await supabase
    .from('profiles')
    .select('resume_path')
    .eq('id', req.user.id)
    .single();

  if (profile?.resume_path) {
    await storageService.deleteFile('resumes', profile.resume_path);
  }

  const uploaded = await storageService.uploadFile(
    'resumes',
    req.file,
    `user-${req.user.id}`
  );

  // Resumes bucket is private — store path and generate public-ish reference via signed URLs later
  const { data: user, error } = await supabase
    .from('profiles')
    .update({
      resume_path: uploaded.path,
      resume_url: uploaded.url,
    })
    .eq('id', req.user.id)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, 'Resume uploaded successfully', sanitizeUser(user));
});

const getPublicProfile = asyncHandler(async (req, res) => {
  // Employers/admins viewing candidate
  const { data: user, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, phone, location, headline, bio, skills, experience_years, education, resume_url, avatar_url, linkedin_url, website, role, created_at'
    )
    .eq('id', req.params.id)
    .single();

  if (error || !user) throw new AppError('Profile not found.', 404);
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
    const [
      { count: totalApplications },
      { count: pending },
      { count: shortlisted },
      { count: hired },
      { count: savedJobs },
      { count: reviewing },
    ] = await Promise.all([
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', userId).is('withdrawn_at', null),
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', userId).eq('status', 'pending').is('withdrawn_at', null),
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', userId).eq('status', 'shortlisted').is('withdrawn_at', null),
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', userId).eq('status', 'hired').is('withdrawn_at', null),
      supabase.from('saved_jobs').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', userId).eq('status', 'reviewing').is('withdrawn_at', null),
    ]);

    const { count: totalJobs } = await supabase
      .from('jobs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('is_suspicious', false);

    stats = {
      totalJobs: totalJobs || 0,
      totalApplications: totalApplications || 0,
      pending: pending || 0,
      reviewing: reviewing || 0,
      shortlisted: shortlisted || 0,
      hired: hired || 0,
      savedJobs: savedJobs || 0,
    };
  } else if (role === 'employer') {
    const { data: jobs } = await supabase.from('jobs').select('id, status').eq('employer_id', userId);
    const jobIds = (jobs || []).map((j) => j.id);
    const activeJobs = (jobs || []).filter((j) => j.status === 'open').length;

    let totalApplicants = 0;
    let shortlisted = 0;
    let hired = 0;
    let pending = 0;

    if (jobIds.length) {
      const [a, s, h, p] = await Promise.all([
        supabase.from('applications').select('*', { count: 'exact', head: true }).in('job_id', jobIds).is('withdrawn_at', null),
        supabase.from('applications').select('*', { count: 'exact', head: true }).in('job_id', jobIds).eq('status', 'shortlisted').is('withdrawn_at', null),
        supabase.from('applications').select('*', { count: 'exact', head: true }).in('job_id', jobIds).eq('status', 'hired').is('withdrawn_at', null),
        supabase.from('applications').select('*', { count: 'exact', head: true }).in('job_id', jobIds).eq('status', 'pending').is('withdrawn_at', null),
      ]);
      totalApplicants = a.count || 0;
      shortlisted = s.count || 0;
      hired = h.count || 0;
      pending = p.count || 0;
    }

    stats = {
      totalJobs: jobs?.length || 0,
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
