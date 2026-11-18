-- Add duration metadata and move the license clock to first activation.
ALTER TABLE licenses ADD COLUMN duration_days INTEGER;
UPDATE licenses
SET duration_days = CASE
  WHEN license_type = 'perpetual' THEN NULL
  WHEN expires_at IS NOT NULL AND starts_at IS NOT NULL AND expires_at > starts_at
    THEN CAST((expires_at - starts_at) / 86400000 AS INTEGER)
  WHEN license_type = 'trial' THEN 30
  ELSE 365
END;
