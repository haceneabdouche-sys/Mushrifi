# Mushrifi License API (Cloudflare Worker + D1)

## Current development status

The Android client implementation is now present on the isolated `feature/device-license-foundation` branch. It includes:

- A per-installation EC P-256 private key held in Android Keystore.
- One-time server challenges and device-proof signatures.
- RSA-SHA256 verification of signed license tokens.
- AES-256-GCM encryption of the cached signed token using a separate Android Keystore key; legacy plaintext token storage is migrated and removed.
- A 30-day online validation interval and a signed 37-day offline deadline.
- Non-destructive read-only behavior after an invalid/expired license or elapsed offline deadline. Student records remain viewable and backup export remains available; restore and write actions are blocked.

**The staging API smoke test passed on 2026-11-16:** the Worker challenge endpoint created a one-time nonce, accepted a valid P-256 device proof far enough to reject an unknown activation code safely, and rejected replay of the consumed challenge. This did not issue a license and does not prove that a valid code can be activated or validated. The Android CI test build also passed, but it is a debug test APK, not a production-signed release. D1 configuration, signing/admin secret ownership, valid-code activation/renewal/suspension, and real-device behavior still require verification. Do not issue customer activation codes or distribute a production APK until these checks pass.

## Security model

- An active license is bound to one Android device public key (EC P-256); a device can have only one active license at a time.
- Activating a newly issued code on a device that already has an active license expires the previous license record and activates the new one. The previous record and device binding remain in history; student data is not involved.
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

The database schema change narrows the unique device index to active licenses only. Apply the updated `schema.sql` to the staging D1 database before deploying the updated Worker. Do not apply it to production as part of this development task.

## Request throttling

The Worker now has separate Cloudflare Rate Limiting bindings in both Wrangler configurations:

- Public license API routes: 30 requests per 60 seconds per client IP.
- Admin routes: 20 requests per 60 seconds per client IP.
- Exceeded limits return HTTP 429 with `Retry-After: 60`.
- If a limiter binding is missing or unavailable, protected routes fail closed with HTTP 503 instead of bypassing protection.
- Staging and production use separate numeric namespaces so their counters do not mix.

Cloudflare's Workers Rate Limiting API is approximate and maintained independently in each Cloudflare location; it is an abuse-throttling layer, not a strict global quota. Since this first layer keys anonymous requests by Cloudflare's client IP, users sharing one public/mobile-network IP can share a bucket. Review the thresholds against real staging traffic before production deployment. For strict global limits, a Durable Object-backed limiter would be required.

The rate-limit regression tests run with `npm run test:rate-limit` and `npm run test:rate-limit-behavior`; both are included in the license Worker CI workflow.

Staging alone has a third binding, `TEST_RATE_LIMITER`, configured for 3 requests per 60 seconds. It enables the harmless `GET /__test/rate-limit-probe` endpoint. The probe returns a small JSON response, does not read or write D1, and is disabled when that binding is absent; production does not bind it. Each live test run uses a temporary session key and sends at most ten harmless requests to the known Staging Worker: the first three should return HTTP 200, followed by HTTP 429 with `Retry-After: 60`. A small overshoot allowance accounts for Cloudflare's approximate, eventually consistent counters. This live probe is run by the Staging deployment workflow. Do not point the test at production or add the test binding to `wrangler.toml`.

Deploy the staging Worker with `wrangler.staging.toml` before running the live probe. Do not deploy the production configuration as part of this task.

## Remaining validation and hardening

- Run the Android build and regression suite; verify the resulting test APK before installation.
- Complete end-to-end tests using a valid staging activation code on a real Android device, including subsequent validation, suspension, and renewal.
- Configure Cloudflare rate limiting and an authenticated owner/admin workflow before public use.
- Review clock-change behavior and Android Keystore key invalidation/recovery.
- Confirm the backup export path remains usable in every read-only failure state.

Never deploy to production or issue customer codes until the above checks pass.
