const { query } = require('../config/database');
const { ApiResponse, AppError } = require('../utils/apiResponse');
const { asyncHandler } = require('../middlewares/error.middleware');
const storageService = require('../services/storage.service');

const createCompany = asyncHandler(async (req, res) => {
  const employerId = req.user.id;
  const existing = await query('SELECT id FROM companies WHERE employer_id = $1', [employerId]);
  if (existing.rows[0]) {
    throw new AppError('You already have a company profile. Use update instead.', 409);
  }

  const { rows } = await query(
    `INSERT INTO companies (
      employer_id, name, description, industry, company_size, website, location, founded_year
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      employerId,
      req.body.name,
      req.body.description || null,
      req.body.industry || null,
      req.body.company_size || null,
      req.body.website || null,
      req.body.location || null,
      req.body.founded_year || null,
    ]
  );
  return ApiResponse.success(res, 201, 'Company profile created', rows[0]);
});

const updateCompany = asyncHandler(async (req, res) => {
  const existing = await query('SELECT * FROM companies WHERE employer_id = $1', [req.user.id]);
  if (!existing.rows[0]) throw new AppError('Company profile not found. Create one first.', 404);

  const allowed = ['name', 'description', 'industry', 'company_size', 'website', 'location', 'founded_year'];
  const sets = [];
  const params = [];
  let i = 1;
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(req.body[k]);
    }
  });
  if (!sets.length) {
    return ApiResponse.success(res, 200, 'Company profile updated', existing.rows[0]);
  }

  params.push(existing.rows[0].id);
  const { rows } = await query(
    `UPDATE companies SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  return ApiResponse.success(res, 200, 'Company profile updated', rows[0]);
});

const getMyCompany = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM companies WHERE employer_id = $1', [req.user.id]);
  return ApiResponse.success(res, 200, 'Company fetched', rows[0] || null);
});

const getCompanyById = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, p.id AS employer_pk, p.full_name AS employer_name
     FROM companies c
     LEFT JOIN profiles p ON p.id = c.employer_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new AppError('Company not found.', 404);
  const company = {
    ...rows[0],
    employer: { id: rows[0].employer_pk, full_name: rows[0].employer_name },
  };
  return ApiResponse.success(res, 200, 'Company fetched', company);
});

const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Logo file is required.', 400);
  const { rows } = await query('SELECT * FROM companies WHERE employer_id = $1', [req.user.id]);
  const company = rows[0];
  if (!company) throw new AppError('Create a company profile first.', 404);

  if (company.logo_path) await storageService.deleteFile('logos', company.logo_path);
  const uploaded = await storageService.uploadFile('logos', req.file, `company-${company.id}`);

  const updated = await query(
    `UPDATE companies SET logo_url = $1, logo_path = $2 WHERE id = $3 RETURNING *`,
    [uploaded.url, uploaded.path, company.id]
  );
  return ApiResponse.success(res, 200, 'Logo uploaded successfully', updated.rows[0]);
});

module.exports = {
  createCompany,
  updateCompany,
  getMyCompany,
  getCompanyById,
  uploadLogo,
};
