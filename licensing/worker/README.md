# Mushrifi License API (Cloudflare Worker + D1)

This is an isolated backend scaffold. It is not deployed and does not affect the Android application yet.

## Security model

- One license is bound to one Android device public key (EC P-256).
- The app proves possession of the private key by signing a one-time server nonce.
- Activation codes are stored as SHA-256 hashes and can be used once.
- License responses are signed by an RSA-SHA256 private key held only as a Worker secret.
- The Android app will embed only the matching public key and verify signed offline licenses.
- Revalidation is expected every 30 days. Signed licenses carry a 37-day offline deadline (30 + 7 grace).
- The API never accesses the Mushrifi student database. Expiry/suspension must not delete local app data.

## Important before deployment

1. Create a Cloudflare account and a D1 database named `mushrifi-licenses`.
2. Replace the placeholder `database_id` in `wrangler.toml`.
3. Generate an RSA 2048-bit key pair. Put the base64-encoded PKCS#8 DER private key in the Worker secret `LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64`. Keep the private key outside Git and outside the APK.
4. Configure `ADMIN_API_TOKEN` as a long random secret using Worker secrets. Never commit either secret.
5. Keep the matching RSA public key for later embedding in Android. Do not publish the private key.
6. Apply `schema.sql` to D1, then test locally and in a separate staging Worker before production.

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

## Known implementation boundary

This backend scaffold is not yet wired into the Android WebView. The Android side still needs:
- Android Keystore P-256 key creation and signing,
- ECDSA signature format conversion between Android DER and WebCrypto raw format,
- RSA-SHA256 license-token verification using the pinned public key,
- secure local storage of the signed token and last trusted server time,
- a non-destructive read-only/export mode after expiry or the offline grace deadline,
- a real-device integration and abuse-case test suite.

Do not deploy to production or issue customer codes until those client controls and tests exist. Cloudflare rate limiting and an authenticated owner dashboard should also be configured before public use.
