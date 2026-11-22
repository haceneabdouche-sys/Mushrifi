-- Add stable app-scoped identity to support same-phone reinstall recovery.
ALTER TABLE licenses ADD COLUMN device_identity_hash TEXT;
ALTER TABLE challenges ADD COLUMN device_identity_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_device_identity_active
ON licenses(device_identity_hash)
WHERE device_identity_hash IS NOT NULL AND status = 'active';
