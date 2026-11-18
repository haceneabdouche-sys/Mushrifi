PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  activation_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('issued', 'active', 'suspended', 'revoked', 'expired')),
  license_type TEXT NOT NULL CHECK (license_type IN ('annual', 'perpetual', 'trial')),
  duration_days INTEGER,
  starts_at INTEGER,
  expires_at INTEGER,
  device_public_key_json TEXT,
  device_thumbprint TEXT,
  activated_at INTEGER,
  last_validated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (status = 'issued' AND device_thumbprint IS NULL AND device_public_key_json IS NULL)
    OR
    (status <> 'issued' AND device_thumbprint IS NOT NULL AND device_public_key_json IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_device_thumbprint
ON licenses(device_thumbprint)
WHERE device_thumbprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_status_expiry
ON licenses(status, expires_at);

CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('activate', 'validate')),
  license_id TEXT,
  activation_code_hash TEXT,
  device_thumbprint TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE INDEX IF NOT EXISTS idx_challenges_expiry ON challenges(expires_at);
