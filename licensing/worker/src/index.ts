export interface Env {
  DB: D1Database;
  ADMIN_API_TOKEN: string;
  LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64: string;
  PUBLIC_RATE_LIMITER: RateLimit;
  ADMIN_RATE_LIMITER: RateLimit;
  // Bound only in Staging; absent in production so the probe endpoint stays disabled.
  TEST_RATE_LIMITER?: RateLimit;
  LICENSE_ISSUER?: string;
  LICENSE_AUDIENCE?: string;
}

type LicenseRow = {
  id: string;
  activation_code_hash: string;
  status: string;
  license_type: string;
  starts_at: number | null;
  expires_at: number | null;
  device_public_key_json: string | null;
  device_thumbprint: string | null;
  device_identity_hash: string | null;
  activated_at: number | null;
  last_validated_at: number | null;
  created_at: number;
};

const DAY = 86_400_000;
const OFFLINE_WINDOW_DAYS = 37; // 30-day check interval + 7-day grace period
const MAX_BODY_BYTES = 16_384;

function json(data: unknown, status = 200, origin = "*"): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "vary": "Origin"
    }
  });
}

function fail(message: string, status = 400, origin = "*"): Response {
  return json({ ok: false, error: message }, status, origin);
}

async function enforceRateLimit(request: Request, env: Env, admin = false, test = false): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const limiter = test ? env.TEST_RATE_LIMITER : admin ? env.ADMIN_RATE_LIMITER : env.PUBLIC_RATE_LIMITER;
  const key = ip.slice(0, 64);
  try {
    if (!limiter) throw new Error("Rate limiter binding is missing");
    const result = await limiter.limit({ key });
    if (result.success) return null;
    return new Response(JSON.stringify({
      ok: false,
      error: "تم تجاوز عدد الطلبات المسموح به. يرجى المحاولة بعد دقيقة."
    }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
        "retry-after": "60"
      }
    });
  } catch {
    // Fail closed: a missing or unavailable limiter must never silently disable
    // protection on activation, validation, recovery, or administration routes.
    return fail("خدمة الحماية غير متاحة مؤقتاً؛ حاول لاحقاً", 503);
  }
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function canonicalDeviceJwk(value: unknown): JsonWebKey {
  if (!value || typeof value !== "object") throw new Error("مفتاح الجهاز غير صالح");
  const jwk = value as JsonWebKey;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || jwk.d) {
    throw new Error("يجب إرسال المفتاح العام EC P-256 فقط");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true };
}

async function deviceThumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return sha256Hex(canonical);
}

async function verifyDeviceProof(jwk: JsonWebKey, nonce: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      toArrayBuffer(fromB64(signature)),
      toArrayBuffer(new TextEncoder().encode(nonce))
    );
  } catch {
    return false;
  }
}

async function signLicense(env: Env, row: LicenseRow, now: number): Promise<string> {
  if (!env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64) throw new Error("مفتاح توقيع التراخيص غير مضبوط على الخادم");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(fromB64(env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const payload = {
    iss: env.LICENSE_ISSUER || "mushrifi-license",
    aud: env.LICENSE_AUDIENCE || "dz.mushrifi.app.offline",
    licenseId: row.id,
    licenseType: row.license_type,
    status: row.status,
    deviceThumbprint: row.device_thumbprint,
    issuedAt: now,
    startsAt: row.starts_at ?? now,
    expiresAt: row.expires_at,
    lastValidatedAt: now,
    offlineUntil: now + OFFLINE_WINDOW_DAYS * DAY
  };
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, toArrayBuffer(new TextEncoder().encode(encoded)));
  return encoded + "." + b64url(new Uint8Array(signature));
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error("حجم الطلب أكبر من المسموح");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("صيغة الطلب غير صحيحة");
  return parsed as Record<string, unknown>;
}

function validCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,100}$/.test(value.trim());
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "MSH-" + b64url(bytes).toUpperCase();
}

async function adminAuthorized(request: Request, env: Env): Promise<boolean> {
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + (env.ADMIN_API_TOKEN || "");
  if (!env.ADMIN_API_TOKEN || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function createChallenge(env: Env, body: Record<string, unknown>): Promise<Response> {
  const purpose = body.purpose;
  if (purpose !== "activate" && purpose !== "validate") return fail("نوع التحدي غير صحيح");
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const expires = now + 5 * 60_000;
  let licenseId: string | null = null;
  let codeHash: string | null = null;
  let thumbprint: string;
  let identityHash: string | null = null;

  try {
    if (body.recover === true) {
      if (typeof body.deviceIdentityHash !== "string" || !/^[a-f0-9]{64}$/.test(body.deviceIdentityHash)) return fail("معرّف الجهاز غير صالح");
      const jwk = canonicalDeviceJwk(body.devicePublicKey);
      thumbprint = await deviceThumbprint(jwk);
      identityHash = body.deviceIdentityHash;
      const license = await env.DB.prepare("SELECT id FROM licenses WHERE device_identity_hash = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)").bind(identityHash, now).first<{id:string}>();
      if (!license) return fail("لا يوجد ترخيص نشط محفوظ لهذا الهاتف", 404);
      licenseId = license.id;
    } else if (purpose === "activate") {
      if (!validCode(body.activationCode)) return fail("رمز التفعيل غير صالح");
      const jwk = canonicalDeviceJwk(body.devicePublicKey);
      thumbprint = await deviceThumbprint(jwk);
      codeHash = await sha256Hex(body.activationCode.trim().toUpperCase());
      if (typeof body.deviceIdentityHash === "string" && /^[a-f0-9]{64}$/.test(body.deviceIdentityHash)) identityHash = body.deviceIdentityHash;
    } else {
      if (typeof body.licenseId !== "string" || !body.licenseId) return fail("معرّف الترخيص مطلوب");
      const license = await env.DB.prepare(
        "SELECT id, status, device_public_key_json, device_thumbprint FROM licenses WHERE id = ?"
      ).bind(body.licenseId).first<{id:string;status:string;device_public_key_json:string|null;device_thumbprint:string|null}>();
      if (!license || license.status !== "active" || !license.device_public_key_json || !license.device_thumbprint) {
        return fail("الترخيص غير نشط أو غير موجود", 403);
      }
      licenseId = license.id;
      thumbprint = license.device_thumbprint;
      if (typeof body.deviceIdentityHash === "string" && /^[a-f0-9]{64}$/.test(body.deviceIdentityHash)) identityHash = body.deviceIdentityHash;
    }
    // Remove expired one-time challenges opportunistically to keep the D1 table bounded.
    await env.DB.prepare("DELETE FROM challenges WHERE expires_at <= ?").bind(now).run();
    await env.DB.prepare(
      "INSERT INTO challenges (nonce, purpose, license_id, activation_code_hash, device_thumbprint, device_identity_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(nonce, purpose, licenseId, codeHash, thumbprint, identityHash, expires, now).run();
    return json({ ok: true, nonce, expiresAt: expires, licenseId });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "تعذر إنشاء التحدي");
  }
}

async function activate(env: Env, body: Record<string, unknown>): Promise<Response> {
  if (!validCode(body.activationCode) || typeof body.nonce !== "string" || typeof body.signature !== "string") {
    return fail("بيانات التفعيل غير مكتملة");
  }
  const now = Date.now();
  try {
    const jwk = canonicalDeviceJwk(body.devicePublicKey);
    const thumbprint = await deviceThumbprint(jwk);
    const codeHash = await sha256Hex(body.activationCode.trim().toUpperCase());
    const identityHash = typeof body.deviceIdentityHash === "string" && /^[a-f0-9]{64}$/.test(body.deviceIdentityHash) ? body.deviceIdentityHash : null;
    const challenge = await env.DB.prepare(
      "UPDATE challenges SET consumed_at = ? WHERE nonce = ? AND purpose = 'activate' AND activation_code_hash = ? AND device_thumbprint = ? AND device_identity_hash IS ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce"
    ).bind(now, body.nonce, codeHash, thumbprint, identityHash, now).first();
    if (!challenge) return fail("انتهت صلاحية طلب التفعيل أو استُخدم مسبقاً", 409);
    if (!(await verifyDeviceProof(jwk, body.nonce, body.signature))) return fail("تعذر إثبات ملكية مفتاح هذا الهاتف", 401);

    const candidate = await env.DB.prepare(
      "SELECT * FROM licenses WHERE activation_code_hash = ? AND status = 'issued' AND device_thumbprint IS NULL"
    ).bind(codeHash).first<LicenseRow>();
    if (!candidate) return fail("رمز التفعيل غير صحيح أو سبق استعماله", 409);
    const startsAt = candidate.starts_at ?? now;
    // If this phone already has an active license, retire that record before
    // activating the newly issued code. The unique index permits only one
    // active license per device; expired history remains intact.
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE licenses SET status = 'expired', updated_at = ? WHERE status = 'active' AND (device_thumbprint = ? OR (? IS NOT NULL AND device_identity_hash = ?)) AND EXISTS (SELECT 1 FROM licenses WHERE id = ? AND status = 'issued' AND device_thumbprint IS NULL)"
      ).bind(now, thumbprint, identityHash, identityHash, candidate.id),
      env.DB.prepare(
        "UPDATE licenses SET status = 'active', device_public_key_json = ?, device_thumbprint = ?, device_identity_hash = ?, activated_at = ?, starts_at = ?, last_validated_at = ?, updated_at = ? WHERE id = ? AND status = 'issued' AND device_thumbprint IS NULL"
      ).bind(JSON.stringify(jwk), thumbprint, identityHash, now, startsAt, now, now, candidate.id)
    ]);
    const updated = await env.DB.prepare(
      "SELECT * FROM licenses WHERE id = ? AND status = 'active' AND device_thumbprint = ?"
    ).bind(candidate.id, thumbprint).first<LicenseRow>();
    if (!updated) return fail("رمز التفعيل غير صالح أو سبق استعماله؛ لم يتم تغيير الترخيص السابق", 409);
    const token = await signLicense(env, updated, now);
    return json({ ok: true, license: token, nextCheckAt: now + 30 * DAY, graceDays: 7 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "فشل التفعيل");
  }
}

async function recoverLicense(env: Env, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.licenseId !== "string" || typeof body.deviceIdentityHash !== "string" || !/^[a-f0-9]{64}$/.test(body.deviceIdentityHash) || typeof body.nonce !== "string" || typeof body.signature !== "string") return fail("بيانات استعادة الترخيص غير مكتملة");
  const now = Date.now();
  try {
    const jwk = canonicalDeviceJwk(body.devicePublicKey);
    const thumbprint = await deviceThumbprint(jwk);
    const license = await env.DB.prepare("SELECT * FROM licenses WHERE id = ? AND device_identity_hash = ? AND status = 'active'").bind(body.licenseId, body.deviceIdentityHash).first<LicenseRow>();
    if (!license || (license.expires_at !== null && license.expires_at <= now)) return fail("الترخيص غير نشط أو انتهت مدته", 403);
    const challenge = await env.DB.prepare("UPDATE challenges SET consumed_at = ? WHERE nonce = ? AND purpose = 'validate' AND license_id = ? AND device_thumbprint = ? AND device_identity_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce").bind(now, body.nonce, license.id, thumbprint, body.deviceIdentityHash, now).first();
    if (!challenge) return fail("انتهت صلاحية طلب الاستعادة أو استُخدم مسبقاً", 409);
    if (!(await verifyDeviceProof(jwk, body.nonce, body.signature))) return fail("تعذر إثبات ملكية مفتاح التطبيق الجديد", 401);
    await env.DB.prepare("UPDATE licenses SET device_public_key_json = ?, device_thumbprint = ?, last_validated_at = ?, updated_at = ? WHERE id = ? AND device_identity_hash = ? AND status = 'active'").bind(JSON.stringify(jwk), thumbprint, now, now, license.id, body.deviceIdentityHash).run();
    const updated = await env.DB.prepare("SELECT * FROM licenses WHERE id = ?").bind(license.id).first<LicenseRow>();
    if (!updated) return fail("تعذر تحديث ربط الجهاز", 500);
    return json({ ok: true, license: await signLicense(env, updated, now), nextCheckAt: now + 30 * DAY, graceDays: 7 });
  } catch (error) { return fail(error instanceof Error ? error.message : "تعذرت استعادة الترخيص"); }
}
async function validateLicense(env: Env, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.licenseId !== "string" || typeof body.nonce !== "string" || typeof body.signature !== "string") {
    return fail("بيانات التحقق غير مكتملة");
  }
  const now = Date.now();
  try {
    const license = await env.DB.prepare("SELECT * FROM licenses WHERE id = ?")
      .bind(body.licenseId).first<LicenseRow>();
    if (!license || license.status !== "active" || !license.device_public_key_json || !license.device_thumbprint) {
      return fail("الترخيص غير نشط", 403);
    }
    const jwk = JSON.parse(license.device_public_key_json) as JsonWebKey;
    const identityHash = typeof body.deviceIdentityHash === "string" && /^[a-f0-9]{64}$/.test(body.deviceIdentityHash) ? body.deviceIdentityHash : null;
    if (license.device_identity_hash && identityHash && license.device_identity_hash !== identityHash) return fail("هوية الهاتف لا تطابق الترخيص", 403);
    const challenge = await env.DB.prepare(
      "UPDATE challenges SET consumed_at = ? WHERE nonce = ? AND purpose = 'validate' AND license_id = ? AND device_thumbprint = ? AND device_identity_hash IS ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce"
    ).bind(now, body.nonce, license.id, license.device_thumbprint, identityHash, now).first();
    if (!challenge) return fail("انتهت صلاحية طلب التحقق أو استُخدم مسبقاً", 409);
    if (!(await verifyDeviceProof(jwk, body.nonce, body.signature))) return fail("فشل إثبات هوية الهاتف", 401);
    if (license.expires_at !== null && license.expires_at <= now) {
      await env.DB.prepare("UPDATE licenses SET status = 'expired', updated_at = ? WHERE id = ?").bind(now, license.id).run();
      return fail("انتهت مدة الترخيص؛ بياناتك محفوظة ويمكنك تصدير النسخة الاحتياطية", 403);
    }
    await env.DB.prepare("UPDATE licenses SET device_identity_hash = COALESCE(device_identity_hash, ?), last_validated_at = ?, updated_at = ? WHERE id = ?")
      .bind(identityHash, now, now, license.id).run();
    const refreshed = { ...license, device_identity_hash: license.device_identity_hash || identityHash, last_validated_at: now };
    const token = await signLicense(env, refreshed, now);
    return json({ ok: true, license: token, nextCheckAt: now + 30 * DAY, graceDays: 7 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "تعذر التحقق من الترخيص");
  }
}

async function adminRoute(request: Request, env: Env, path: string): Promise<Response> {
  if (!(await adminAuthorized(request, env))) return fail("غير مصرح", 401);
  const now = Date.now();

  if (request.method === "POST" && path === "/v1/admin/licenses") {
    const body = await readBody(request);
    const type = body.licenseType;
    if (type !== "annual" && type !== "perpetual" && type !== "trial") return fail("نوع الترخيص غير معتمد");
    const duration = type === "perpetual" ? null : Number(body.durationDays ?? (type === "trial" ? 30 : 365));
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) return fail("مدة الترخيص غير صحيحة");
    const code = randomCode();
    const hash = await sha256Hex(code);
    const id = crypto.randomUUID();
    const expiresAt = duration === null ? null : now + duration * DAY;
    await env.DB.prepare(
      "INSERT INTO licenses (id, activation_code_hash, status, license_type, starts_at, expires_at, created_at, updated_at) VALUES (?, ?, 'issued', ?, ?, ?, ?, ?)"
    ).bind(id, hash, type, now, expiresAt, now, now).run();
    return json({ ok: true, licenseId: id, activationCode: code, licenseType: type, expiresAt, warning: "يظهر رمز التفعيل مرة واحدة فقط؛ احفظه بأمان." }, 201);
  }

  if (request.method === "GET" && path === "/v1/admin/licenses") {
    const rows = await env.DB.prepare(
      "SELECT id, status, license_type, starts_at, expires_at, activated_at, last_validated_at, device_thumbprint, created_at FROM licenses ORDER BY created_at DESC LIMIT 500"
    ).all();
    return json({ ok: true, licenses: rows.results || [] });
  }

  const match = path.match(/^\/v1\/admin\/licenses\/([0-9a-f-]+)\/(suspend|renew)$/i);
  if (request.method === "POST" && match) {
    const id = match[1];
    const action = match[2];
    const existing = await env.DB.prepare("SELECT * FROM licenses WHERE id = ?").bind(id).first<LicenseRow>();
    if (!existing) return fail("الترخيص غير موجود", 404);
    if (action === "suspend") {
      await env.DB.prepare("UPDATE licenses SET status = 'suspended', updated_at = ? WHERE id = ?").bind(now, id).run();
      return json({ ok: true, status: "suspended" });
    }
    if (existing.status !== "active" && existing.status !== "expired") return fail("لا يمكن تجديد هذا الترخيص في حالته الحالية", 409);
    const body = await readBody(request);
    const days = Number(body.durationDays ?? 365);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return fail("مدة التجديد غير صحيحة");
    const base = existing.expires_at && existing.expires_at > now ? existing.expires_at : now;
    const expiry = base + days * DAY;
    await env.DB.prepare("UPDATE licenses SET status = 'active', expires_at = ?, updated_at = ? WHERE id = ?")
      .bind(expiry, now, id).run();
    return json({ ok: true, expiresAt: expiry, note: "يحتاج الهاتف إلى تحقق متصل لتلقي الترخيص المحدث." });
  }
  return fail("المسار غير موجود", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "mushrifi-license-api" });

    // Harmless integration probe. It is enabled only when the Staging-only
    // TEST_RATE_LIMITER binding is present and never touches the D1 database.
    if (request.method === "GET" && url.pathname === "/__test/rate-limit-probe") {
      if (!env.TEST_RATE_LIMITER) return fail("المسار غير موجود", 404);
      const limited = await enforceRateLimit(request, env, false, true);
      if (limited) return limited;
      return json({ ok: true, probe: "rate-limit" });
    }

    if (url.pathname.startsWith("/v1/admin/")) {
      const limited = await enforceRateLimit(request, env, true);
      if (limited) return limited;
      return adminRoute(request, env, url.pathname);
    }
    if (request.method !== "POST") return fail("الطريقة غير مدعومة", 405);

    if (url.pathname.startsWith("/v1/")) {
      const limited = await enforceRateLimit(request, env);
      if (limited) return limited;
    }

    let body: Record<string, unknown>;
    try {
      body = await readBody(request);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "تعذر قراءة الطلب");
    }

    if (url.pathname === "/v1/challenge") return createChallenge(env, body);
    if (url.pathname === "/v1/activate") return activate(env, body);
    if (url.pathname === "/v1/validate") return validateLicense(env, body);
    if (url.pathname === "/v1/recover") return recoverLicense(env, body);
    return fail("المسار غير موجود", 404);
  }
};
