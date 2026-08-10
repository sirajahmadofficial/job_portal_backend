-- ============================================================
-- Supabase Storage buckets for Job Portal
-- Run in SQL Editor after schema.sql
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'resumes',
    'resumes',
    false,
    5242880,
    ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'logos',
    'logos',
    true,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
ON CONFLICT (id) DO NOTHING;

-- Logos: public read
CREATE POLICY "logos_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'logos');

-- Service role / authenticated uploads are handled by backend with service key.
-- Deny direct anon writes; backend uses service role.
CREATE POLICY "logos_deny_anon_write"
ON storage.objects FOR INSERT
WITH CHECK (false);

CREATE POLICY "resumes_deny_anon"
ON storage.objects FOR ALL
USING (false);
