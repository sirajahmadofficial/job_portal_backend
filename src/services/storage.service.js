const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../utils/apiResponse');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const uploadFile = async (bucket, file, folder = '') => {
  if (!file) throw new AppError('No file provided.', 400);

  const folderPath = path.join(UPLOAD_ROOT, bucket, folder);
  ensureDir(folderPath);

  const ext = path.extname(file.originalname).toLowerCase() || '';
  const fileName = `${uuidv4()}${ext}`;
  const relativePath = path.join(bucket, folder, fileName).replace(/\\/g, '/');
  const absolutePath = path.join(UPLOAD_ROOT, relativePath);

  fs.writeFileSync(absolutePath, file.buffer);

  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  return {
    path: relativePath,
    url: `${baseUrl}/uploads/${relativePath}`,
  };
};

const deleteFile = async (_bucket, filePath) => {
  if (!filePath) return;
  const absolutePath = path.join(UPLOAD_ROOT, filePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const getSignedUrl = async (_bucket, filePath) => {
  if (!filePath) throw new AppError('File path missing.', 404);
  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${baseUrl}/uploads/${filePath}`;
};

module.exports = { uploadFile, deleteFile, getSignedUrl, UPLOAD_ROOT };
