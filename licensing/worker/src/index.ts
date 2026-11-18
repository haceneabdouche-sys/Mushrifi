export interface Env {
  DB: D1Database;
  ADMIN_API_TOKEN: string;
  LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64: string;
  LICENSE_ISSUER?: string;
  LICENSE_AUDIENCE?: string;
}

type LicenseRow = {
  id: string;
  activation_code_hash: string;
  status: string;
  license_type: string;
  duration_days: number | null;
  starts_at: number | null;
  expires_at: number | null;
  device_public_key_json: string | null;
  device_thumbprint: string | null;
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
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error("حجم الطلب أكبر من المسموح");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("محتوى الطلب مطلوب");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("حجم الطلب أكبر من المسموح");
    }
    chunks.push(part.value);
  }
  reader.releaseLock();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("صيغة الطلب غير صحيحة");
  return parsed as Record<string, unknown>;
}

function validCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{12,100}$/.test(value.trim());
}

function randomCode(): string {
  // Hex is deliberately used here because validCode accepts only A-Z, 0-9 and hyphens.
  // Base64url can contain underscores, which the activation endpoint correctly rejects.
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return "MSH-" + hex;
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

  try {
    if (purpose === "activate") {
      if (!validCode(body.activationCode)) return fail("رمز التفعيل غير صالح");
      const jwk = canonicalDeviceJwk(body.devicePublicKey);
      thumbprint = await deviceThumbprint(jwk);
      codeHash = await sha256Hex(body.activationCode.trim().toUpperCase());
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
    }
    // Remove expired one-time challenges opportunistically to keep the D1 table bounded.
    await env.DB.prepare("DELETE FROM challenges WHERE expires_at <= ?").bind(now).run();
    await env.DB.prepare(
      "INSERT INTO challenges (nonce, purpose, license_id, activation_code_hash, device_thumbprint, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(nonce, purpose, licenseId, codeHash, thumbprint, expires, now).run();
    return json({ ok: true, nonce, expiresAt: expires });
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
    const challenge = await env.DB.prepare(
      "UPDATE challenges SET consumed_at = ? WHERE nonce = ? AND purpose = 'activate' AND activation_code_hash = ? AND device_thumbprint = ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce"
    ).bind(now, body.nonce, codeHash, thumbprint, now).first();
    if (!challenge) return fail("انتهت صلاحية طلب التفعيل أو استُخدم مسبقاً", 409);
    if (!(await verifyDeviceProof(jwk, body.nonce, body.signature))) return fail("تعذر إثبات ملكية مفتاح هذا الهاتف", 401);

    const candidate = await env.DB.prepare(
      "SELECT * FROM licenses WHERE activation_code_hash = ? AND status = 'issued' AND device_thumbprint IS NULL"
    ).bind(codeHash).first<LicenseRow>();
    if (!candidate) {
      // Recover a lost activation response only for the same proven device.
      const alreadyActivated = await env.DB.prepare(
        "SELECT * FROM licenses WHERE activation_code_hash = ? AND status = 'active' AND device_thumbprint = ?"
      ).bind(codeHash, thumbprint).first<LicenseRow>();
      if (!alreadyActivated) return fail("رمز التفعيل غير صحيح أو سبق استعماله", 409);
      await env.DB.prepare("UPDATE licenses SET last_validated_at = ?, updated_at = ? WHERE id = ? AND status = 'active'")
        .bind(now, now, alreadyActivated.id).run();
      const recovered = { ...alreadyActivated, last_validated_at: now };
      const recoveryToken = await signLicense(env, recovered, now);
      return json({ ok: true, license: recoveryToken, nextCheckAt: now + 30 * DAY, graceDays: 7 });
    }
    // Sign before committing activation so a missing signing secret cannot consume the code.
    const startsAt = now;
    const durationDays = candidate.duration_days;
    const expiresAt = durationDays === null ? null : startsAt + durationDays * DAY;
    const activatedRow: LicenseRow = {
      ...candidate,
      status: "active",
      device_public_key_json: JSON.stringify(jwk),
      device_thumbprint: thumbprint,
      activated_at: now,
      starts_at: startsAt,
      expires_at: expiresAt,
      last_validated_at: now
    };
    const token = await signLicense(env, activatedRow, now);
    const updated = await env.DB.prepare(
      "UPDATE licenses SET status = 'active', device_public_key_json = ?, device_thumbprint = ?, activated_at = ?, starts_at = ?, expires_at = ?, last_validated_at = ?, updated_at = ? WHERE id = ? AND status = 'issued' AND device_thumbprint IS NULL RETURNING id"
    ).bind(JSON.stringify(jwk), thumbprint, now, startsAt, expiresAt, now, now, candidate.id).first();
    if (!updated) {
      const raced = await env.DB.prepare(
        "SELECT * FROM licenses WHERE id = ? AND status = 'active' AND device_thumbprint = ?"
      ).bind(candidate.id, thumbprint).first<LicenseRow>();
      if (!raced) return fail("تم ربط رمز التفعيل بجهاز آخر بالفعل", 409);
      // Return the persisted winner's dates, never the losing request's candidate dates.
      const racedToken = await signLicense(env, raced, now);
      return json({ ok: true, license: racedToken, nextCheckAt: now + 30 * DAY, graceDays: 7 });
    }
    return json({ ok: true, license: token, nextCheckAt: now + 30 * DAY, graceDays: 7 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "فشل التفعيل");
  }
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
    const challenge = await env.DB.prepare(
      "UPDATE challenges SET consumed_at = ? WHERE nonce = ? AND purpose = 'validate' AND license_id = ? AND device_thumbprint = ? AND consumed_at IS NULL AND expires_at > ? RETURNING nonce"
    ).bind(now, body.nonce, license.id, license.device_thumbprint, now).first();
    if (!challenge) return fail("انتهت صلاحية طلب التحقق أو استُخدم مسبقاً", 409);
    if (!(await verifyDeviceProof(jwk, body.nonce, body.signature))) return fail("فشل إثبات هوية الهاتف", 401);
    if (license.expires_at !== null && license.expires_at <= now) {
      await env.DB.prepare("UPDATE licenses SET status = 'expired', updated_at = ? WHERE id = ?").bind(now, license.id).run();
      return fail("انتهت مدة الترخيص؛ بياناتك محفوظة ويمكنك تصدير النسخة الاحتياطية", 403);
    }
    await env.DB.prepare("UPDATE licenses SET last_validated_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, license.id).run();
    const refreshed = { ...license, last_validated_at: now };
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
    let body: Record<string, unknown>;
    try { body = await readBody(request); }
    catch (error) { return fail(error instanceof Error ? error.message : "صيغة الطلب غير صحيحة", 400); }
    const type = body.licenseType;
    if (type !== "annual" && type !== "perpetual" && type !== "trial") return fail("نوع الترخيص غير معتمد");
    const duration = type === "perpetual" ? null : Number(body.durationDays ?? (type === "trial" ? 30 : 365));
    if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) return fail("مدة الترخيص غير صحيحة");
    const code = randomCode();
    const hash = await sha256Hex(code);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO licenses (id, activation_code_hash, status, license_type, duration_days, starts_at, expires_at, created_at, updated_at) VALUES (?, ?, 'issued', ?, ?, NULL, NULL, ?, ?)"
    ).bind(id, hash, type, duration, now, now).run();
    return json({ ok: true, licenseId: id, activationCode: code, licenseType: type, durationDays: duration, startsAt: null, expiresAt: null, warning: "يظهر رمز التفعيل مرة واحدة فقط؛ احفظه بأمان." }, 201);
  }

  if (request.method === "GET" && path === "/v1/admin/licenses") {
    const rows = await env.DB.prepare(
      "SELECT id, status, license_type, starts_at, expires_at, activated_at, last_validated_at, device_thumbprint, created_at FROM licenses ORDER BY created_at DESC LIMIT 500"
    ).all();
    return json({ ok: true, licenses: rows.results || [] });
  }

  const match = path.match(/^\/v1\/admin\/licenses\/([0-9a-f-]+)\/(suspend|unsuspend|renew|revoke)$/i);
  if (request.method === "POST" && match) {
    const id = match[1];
    const action = match[2];
    const existing = await env.DB.prepare("SELECT * FROM licenses WHERE id = ?").bind(id).first<LicenseRow>();
    if (!existing) return fail("الترخيص غير موجود", 404);
    if (action === "revoke") {
      if (existing.status === "revoked") return json({ ok: true, status: "revoked" });
      if (existing.status === "issued") return fail("لا يمكن إلغاء رمز لم يُربط بجهاز بعد", 409);
      await env.DB.prepare("UPDATE licenses SET status = 'revoked', updated_at = ? WHERE id = ? AND status <> 'issued'")
        .bind(now, id).run();
      return json({ ok: true, status: "revoked" });
    }
    if (action === "suspend") {
      if (existing.status === "issued") return fail("لا يمكن تعليق رمز لم يُفعّل بعد", 409);
      if (existing.status === "revoked") return fail("الترخيص ملغى نهائياً", 409);
      await env.DB.prepare("UPDATE licenses SET status = 'suspended', updated_at = ? WHERE id = ?").bind(now, id).run();
      return json({ ok: true, status: "suspended" });
    }
    if (action === "unsuspend") {
      if (existing.status !== "suspended") return fail("الترخيص ليس معلّقاً", 409);
      if (existing.expires_at !== null && existing.expires_at <= now) return fail("انتهت مدة الترخيص؛ جدّده قبل إعادة تنشيطه", 409);
      await env.DB.prepare("UPDATE licenses SET status = 'active', updated_at = ? WHERE id = ? AND status = 'suspended'")
        .bind(now, id).run();
      return json({ ok: true, status: "active" });
    }
    if (existing.license_type === "perpetual") return fail("الترخيص الدائم لا يحتاج إلى تجديد", 409);
    if (existing.status !== "active" && existing.status !== "expired") return fail("لا يمكن تجديد هذا الترخيص في حالته الحالية", 409);
    let body: Record<string, unknown>;
    try { body = await readBody(request); }
    catch (error) { return fail(error instanceof Error ? error.message : "صيغة الطلب غير صحيحة", 400); }
    const days = Number(body.durationDays ?? 365);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return fail("مدة التجديد غير صحيحة");
    const base = existing.expires_at && existing.expires_at > now ? existing.expires_at : now;
    const expiry = base + days * DAY;
    await env.DB.prepare("UPDATE licenses SET status = 'active', duration_days = ?, expires_at = ?, updated_at = ? WHERE id = ?")
      .bind(days, expiry, now, id).run();
    return json({ ok: true, expiresAt: expiry, note: "يحتاج الهاتف إلى تحقق متصل لتلقي الترخيص المحدث." });
  }
  return fail("المسار غير موجود", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "mushrifi-license-api" });

    if (url.pathname.startsWith("/v1/admin/")) {
      try { return await adminRoute(request, env, url.pathname); }
      catch { return fail("تعذر تنفيذ طلب الإدارة", 500); }
    }
    if (request.method !== "POST") return fail("الطريقة غير مدعومة", 405);

    let body: Record<string, unknown>;
    try {
      body = await readBody(request);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "تعذر قراءة الطلب");
    }

    if (url.pathname === "/v1/challenge") return createChallenge(env, body);
    if (url.pathname === "/v1/activate") return activate(env, body);
    if (url.pathname === "/v1/validate") return validateLicense(env, body);
    return fail("المسار غير موجود", 404);
  }
};
