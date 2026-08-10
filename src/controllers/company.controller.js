const { supabase } = require('../config/database');
const { ApiResponse, AppError } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');
const storageService = require('../services/storage.service');

const createCompany = asyncHandler(async (req, res) => {
  const employerId = req.user.id;

  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('employer_id', employerId)
    .maybeSingle();

  if (existing) {
    throw new AppError('You already have a company profile. Use update instead.', 409);
  }

  const { data: company, error } = await supabase
    .from('companies')
    .insert({
      employer_id: employerId,
      name: req.body.name,
      description: req.body.description || null,
      industry: req.body.industry || null,
      company_size: req.body.company_size || null,
      website: req.body.website || null,
      location: req.body.location || null,
      founded_year: req.body.founded_year || null,
    })
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 201, 'Company profile created', company);
});

const updateCompany = asyncHandler(async (req, res) => {
  const employerId = req.user.id;
  const { data: existing } = await supabase
    .from('companies')
    .select('*')
    .eq('employer_id', employerId)
    .maybeSingle();

  if (!existing) throw new AppError('Company profile not found. Create one first.', 404);

  const allowed = [
    'name', 'description', 'industry', 'company_size',
    'website', 'location', 'founded_year',
  ];
  const updates = {};
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  });

  const { data: company, error } = await supabase
    .from('companies')
    .update(updates)
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, 'Company profile updated', company);
});

const getMyCompany = asyncHandler(async (req, res) => {
  const { data: company, error } = await supabase
    .from('companies')
    .select('*')
    .eq('employer_id', req.user.id)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, 'Company fetched', company);
});

const getCompanyById = asyncHandler(async (req, res) => {
  const { data: company, error } = await supabase
    .from('companies')
    .select('*, employer:employer_id (id, full_name)')
    .eq('id', req.params.id)
    .single();

  if (error || !company) throw new AppError('Company not found.', 404);
  return ApiResponse.success(res, 200, 'Company fetched', company);
});

const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Logo file is required.', 400);

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('employer_id', req.user.id)
    .maybeSingle();

  if (!company) throw new AppError('Create a company profile first.', 404);

  if (company.logo_path) {
    await storageService.deleteFile('logos', company.logo_path);
  }

  const uploaded = await storageService.uploadFile('logos', req.file, `company-${company.id}`);

  const { data: updated, error } = await supabase
    .from('companies')
    .update({ logo_url: uploaded.url, logo_path: uploaded.path })
    .eq('id', company.id)
    .select('*')
    .single();

  if (error) throw new AppError(error.message, 500);
  return ApiResponse.success(res, 200, 'Logo uploaded successfully', updated);
});

module.exports = {
  createCompany,
  updateCompany,
  getMyCompany,
  getCompanyById,
  uploadLogo,
};
