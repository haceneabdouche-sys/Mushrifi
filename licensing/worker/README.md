# Mushrifi License API (Cloudflare Worker + D1)

## Current development status

The Android client implementation is now present on the isolated `feature/device-license-foundation` branch. It includes:

- A per-installation EC P-256 private key held in Android Keystore.
- One-time server challenges and device-proof signatures.
- RSA-SHA256 verification of signed license tokens.
- AES-256-GCM encryption of the cached signed token using a separate Android Keystore key; legacy plaintext token storage is migrated and removed.
- A 30-day online validation interval and a signed 37-day offline deadline.
- Non-destructive read-only behavior after an invalid/expired license or elapsed offline deadline. Student records remain viewable and backup export remains available; restore and write actions are blocked.

**The staging API smoke test and Worker TypeScript check passed on 2026-11-17:** the Worker challenge endpoint created a one-time nonce, accepted a valid P-256 device proof far enough to reject an unknown activation code safely, and rejected replay of the consumed challenge. This did not issue a license and does not prove that a valid code can be activated or validated. The Android CI test build also passed, but it is a debug test APK, not a production-signed release. D1 configuration, signing/admin secret ownership, valid-code activation/renewal/suspension, and real-device behavior still require verification. Do not issue customer activation codes or distribute a production APK until these checks pass.

## Security model

- One license is bound to one Android device public key (EC P-256).
- The app proves possession of the private key by signing a one-time server nonce.
- Activation codes are stored as SHA-256 hashes and can be used once.
- License responses are signed by an RSA-SHA256 private key held only as a Worker secret.
- The APK embeds only the matching RSA public key.
- Cached signed tokens are encrypted with AES-256-GCM; the AES key is held by Android Keystore.
- Revalidation is expected every 30 days. Signed licenses carry a 37-day offline deadline (30 + 7 grace).
- The API never accesses the Mushrifi student database. Expiry/suspension must not delete local app data.

## Important before deployment

1. Verify the Cloudflare account and D1 database named `mushrifi-licenses` in the dashboard.
2. Verify the D1 database ID in `wrangler.toml` and confirm that `schema.sql` is applied.
3. Generate an RSA 2048-bit key pair. Put the base64-encoded PKCS#8 DER private key in the Worker secret `LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64`. Keep the private key outside Git and outside the APK.
4. Configure `ADMIN_API_TOKEN` as a long random secret using Worker secrets. Never commit either secret.
5. Verify that the public key embedded in `LicenseManager.java` matches the private key configured on the Worker.
6. Deploy first to a separate staging Worker and verify `GET /health`, activation, validation, suspension, renewal, and expired-license behavior.
7. Complete Android CI and real-device tests, including offline mode, clock rollback, app restart, reinstall behavior, and backup export before production use.

Example secret commands (run locally in a trusted terminal; do not paste secrets into chat):

```sh
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64
```

## API

- `GET /health`
- `POST /v1/challenge` with `{ "purpose":"activate", "activationCode":"...", "devicePublicKey":{...JWK...} }`
- `POST /v1/activate` with activation code, public JWK, nonce, and ECDSA signature of the nonce.
- `POST /v1/challenge` with `{ "purpose":"validate", "licenseId":"..." }`
- `POST /v1/validate` with license ID, nonce, and ECDSA signature.
- Admin endpoints require `Authorization: Bearer <ADMIN_API_TOKEN>`:
  - `POST /v1/admin/licenses` — issue annual, perpetual, or trial code. The code is shown once.
  - `GET /v1/admin/licenses`
  - `POST /v1/admin/licenses/{id}/suspend`
  - `POST /v1/admin/licenses/{id}/renew` with `{ "durationDays":365 }`

## Owner CLI (run locally)

A small owner-only command-line tool is available at `scripts/admin.mjs`. It never stores the admin token in the repository and refuses admin actions when the environment variable is missing.

```sh
export MUSHRIFI_ADMIN_API_TOKEN="YOUR_ADMIN_TOKEN"
node scripts/admin.mjs help
node scripts/admin.mjs issue annual
node scripts/admin.mjs list
node scripts/admin.mjs suspend LICENSE_ID
node scripts/admin.mjs renew LICENSE_ID 365
```

On Windows PowerShell, set the environment variable for the current terminal with:

```powershell
$env:MUSHRIFI_ADMIN_API_TOKEN = "YOUR_ADMIN_TOKEN"
node scripts/admin.mjs issue annual
```

The activation code is displayed only in the issue command response. Save it securely; the API stores only its hash and cannot reveal it again. Never paste the admin token or signing private key into ChatGPT, source files, or Git commits. This CLI is not a hosted dashboard and has not been exercised with a real owner token in this project.
## Remaining validation and hardening

- Run the Android build and regression suite; verify the resulting test APK before installation.
- Complete end-to-end tests using a valid staging activation code on a real Android device, including subsequent validation, suspension, and renewal.
- Configure Cloudflare rate limiting and an authenticated owner/admin workflow before public use.
- Review clock-change behavior and Android Keystore key invalidation/recovery.
- Confirm the backup export path remains usable in every read-only failure state.

Never deploy to production or issue customer codes until the above checks pass.
