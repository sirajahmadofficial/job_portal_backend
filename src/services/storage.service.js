const { supabase } = require('../config/database');
const { AppError } = require('../utils/apiResponse');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadFile = async (bucket, file, folder = '') => {
  if (!file) throw new AppError('No file provided.', 400);

  const ext = path.extname(file.originalname).toLowerCase() || '';
  const fileName = `${folder ? `${folder}/` : ''}${uuidv4()}${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(fileName, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (error) {
    throw new AppError(`File upload failed: ${error.message}`, 500);
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(fileName);

  return {
    path: fileName,
    url: publicData?.publicUrl || null,
  };
};

const deleteFile = async (bucket, filePath) => {
  if (!filePath) return;
  await supabase.storage.from(bucket).remove([filePath]);
};

const getSignedUrl = async (bucket, filePath, expiresIn = 900) => {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn);

  if (error) throw new AppError(`Failed to create signed URL: ${error.message}`, 500);
  return data.signedUrl;
};

module.exports = { uploadFile, deleteFile, getSignedUrl };
