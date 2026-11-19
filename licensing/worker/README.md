# Mushrifi License API (Cloudflare Worker + D1)

## Current development status

The Android client implementation is now included in the primary `main` branch. It includes:

- A per-installation EC P-256 private key held in Android Keystore.
- One-time server challenges and device-proof signatures.
- RSA-SHA256 verification of signed license tokens.
- AES-256-GCM encryption of the cached signed token using a separate Android Keystore key; legacy plaintext token storage is migrated and removed.
- A 30-day online validation interval and a signed 37-day offline deadline.
- Non-destructive read-only behavior after an invalid/expired license or elapsed offline deadline. Student records remain viewable and backup export remains available; restore and write actions are blocked.

**Development branch hardening:** activation now signs the token before committing the one-use code and permits recovery after a lost response only when the same device proves possession of its key. Admin revocation is implemented for activated licenses. These changes are under CI validation and are not deployed.

**The staging API smoke test passed on 2026-11-16:** the Worker challenge endpoint created a one-time nonce, accepted a valid P-256 device proof far enough to reject an unknown activation code safely, and rejected replay of the consumed challenge. This did not issue a license and does not prove that a valid code can be activated or validated. The Android CI test build also passed, but it is a debug test APK, not a production-signed release. D1 configuration, signing/admin secret ownership, valid-code activation/renewal/suspension, and real-device behavior still require verification. Do not issue customer activation codes or distribute a production APK until these checks pass.

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
2. Verify the D1 database ID in `wrangler.toml` and inspect `PRAGMA table_info(licenses)` before changing its schema. For a brand-new empty database, apply `schema.sql` once. For an existing database created from the older schema, apply `migrations/0002-first-activation-duration.sql` only if `duration_days` is absent. Do not apply that migration after `schema.sql` has already created `duration_days`, or SQLite will report a duplicate column.
3. Generate an RSA 2048-bit key pair. Put the base64-encoded PKCS#8 DER private key in the Worker secret `LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64`. Keep the private key outside Git and outside the APK.
4. Configure `ADMIN_API_TOKEN` as a long random secret using Worker secrets. Never commit either secret.
5. Verify that the public key embedded in `LicenseManager.java` matches the private key configured on the Worker. If you still have the original PKCS#8 DER key, run `LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64="$(base64 -w0 license-private-key.pk8)" node scripts/verify-key-pair.mjs` from `licensing/worker` in a trusted terminal. The script prints only MATCH/FAIL and never prints key material. Cloudflare does not reveal a stored secret; if the original key is lost, plan a coordinated key rotation and new APK instead of guessing.
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
  - `POST /v1/admin/licenses/{id}/suspend` — temporarily suspend an activated license.
  - `POST /v1/admin/licenses/{id}/unsuspend` — restore a suspended license while its term remains valid.
  - `POST /v1/admin/licenses/{id}/revoke` — permanently revoke an activated license; the device learns this at its next online validation.
  - `POST /v1/admin/licenses/{id}/renew` with `{ "durationDays":365 }`

## Worker-level rate limiting

The API is served on a `workers.dev` hostname, so the first protection layer is implemented inside the Worker with Cloudflare Rate Limiting bindings (rather than assuming zone-level WAF rules can be attached to the managed `workers.dev` zone).

Current per-client-IP thresholds:

| Endpoint | Limit |
| --- | ---: |
| `POST /v1/challenge` | 30 requests / 60 seconds |
| `POST /v1/activate` | 10 requests / 60 seconds |
| `POST /v1/validate` | 20 requests / 60 seconds |
| `/v1/admin/*` | 30 requests / 60 seconds |

When a threshold is reached, the Worker returns HTTP `429` with `Retry-After: 60`. If the rate-limit service itself is unavailable, protected requests fail closed with HTTP `503` rather than silently running without protection. CI now includes both a static configuration check and a runtime test that injects mocked Cloudflare bindings into the Worker handler, verifying all four routes, the `429` response, the retry header, client-IP keying, and fail-closed `503` behavior. Wrangler's local runtime does not provide the Cloudflare-hosted counter service, so this does not replace a live staging test. The local D1 lifecycle test uses a test-only bypass generated in CI's disposable `.dev.vars` file; this bypass must never be set on a deployed Worker.

Important limitations:
- Cloudflare's Worker Rate Limiting API is approximate and each Cloudflare location maintains separate counters; it is not a strict worldwide limit.
- The counter uses the connecting IP. People sharing one public IP (for example, a school or mobile carrier NAT) share that allowance, so thresholds should be monitored and adjusted if legitimate users are affected.
- These bindings are protection against bursts and simple brute-force attempts, not a replacement for strict global coordination or a full admin access workflow.
- Namespace IDs in `wrangler.toml` must remain unique within the Cloudflare account. Confirm they do not collide with other Worker rate-limit bindings before deployment.

The rate limiting configuration is code-reviewed and CI-tested on the development branch only. It is not active on the deployed Worker until an explicitly approved deployment is performed.

## Remaining validation and hardening

- Run the Android build and regression suite; verify the resulting test APK before installation.
- Complete end-to-end tests using a valid staging activation code on a real Android device, including subsequent validation, suspension, revocation, renewal, and recovery after an interrupted activation.
- Before deployment, verify the four rate-limit namespace IDs are unique in the Cloudflare account and perform a live staging burst test that confirms HTTP `429` and `Retry-After`.
- Review clock-change behavior and Android Keystore key invalidation/recovery.
- Confirm the backup export path remains usable in every read-only failure state.

Never deploy to production or issue customer codes until the above checks pass.
