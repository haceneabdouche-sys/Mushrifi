package dz.mushrifi.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.SignatureException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;


/**
 * Native Mushrifi licensing foundation.
 * Device private key never leaves Android Keystore.
 * The server signing private key is never included in this app.
 */
final class LicenseManager {
    private static final String API = BuildConfig.MUSHRIFI_LICENSE_API;
    private static final String KEY_ALIAS = "mushrifi_device_license_ec";
    private static final String TOKEN_KEY_ALIAS = "mushrifi_license_token_aes";
    private static final String PREFS = "mushrifi_license";
    private static final String PUBLIC_KEY_PEM =
        "-----BEGIN PUBLIC KEY-----\n" +
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6wcOzqQD+CCXf7TbW9LZ\n" +
        "DUnhF6f/iXZV642F7JoCLOdz+jKa85zDc9yORVB2H3M0MNl269pFNJZsbj+qOP5M\n" +
        "/+i30Zszf3EA6oC5B8EMLzOfJGOHW559SyOm23+gK7g66FoAir5Rr+YO5JE94N92\n" +
        "Je02YqLAtpFBHSfUL7g9/kDwszAlnGl9zx5toi43JdpmF2/sF6/X8tq7T0wr/sSg\n" +
        "zl97jDEi9UYSp22rw0Z369OLuFXHC8Nzk7WLAm584U176VWYWhhlbBDXRgBkrPme\n" +
        "aR1rJ/HaL+rsrxnbk5rwijc2pznts6M5TBY4iLOcX+hFz2D19bsTEsCWR7if857v\n" +
        "SQIDAQAB\n" +
        "-----END PUBLIC KEY-----";

    private LicenseManager() {}

    static JSONObject activate(Context context, String activationCode) throws Exception {
        if (activationCode == null || !activationCode.trim().matches("[A-Za-z0-9-]{12,100}"))
            throw new Exception("رمز التفعيل غير صالح");
        KeyPair pair = getOrCreateDeviceKey();
        JSONObject publicJwk = publicJwk((ECPublicKey) pair.getPublic());
        JSONObject challenge = post("/v1/challenge", new JSONObject()
            .put("purpose", "activate")
            .put("activationCode", activationCode.trim())
            .put("devicePublicKey", publicJwk));
        String nonce = challenge.getString("nonce");
        JSONObject response = post("/v1/activate", new JSONObject()
            .put("activationCode", activationCode.trim())
            .put("devicePublicKey", publicJwk)
            .put("nonce", nonce)
            .put("signature", signNonce(pair, nonce)));
        String token = response.getString("license");
        JSONObject payload = verifyAndReadToken(token);
        if (!"active".equals(payload.optString("status")) ||
            !deviceThumbprint(publicJwk).equals(payload.optString("deviceThumbprint")))
            throw new Exception("بيانات الترخيص لا تطابق هذا الهاتف");
        save(context, token, payload);
        return status(context);
    }

    static JSONObject validate(Context context) throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String licenseId = prefs.getString("license_id", null);
        if (licenseId == null) throw new Exception("لم يتم تفعيل هذا الجهاز بعد");
        try {
            KeyPair pair = getOrCreateDeviceKey();
            JSONObject challenge = post("/v1/challenge", new JSONObject()
                .put("purpose", "validate")
                .put("licenseId", licenseId));
            String nonce = challenge.getString("nonce");
            JSONObject response = post("/v1/validate", new JSONObject()
                .put("licenseId", licenseId)
                .put("nonce", nonce)
                .put("signature", signNonce(pair, nonce)));
            String token = response.getString("license");
            JSONObject payload = verifyAndReadToken(token);
            String currentThumbprint = deviceThumbprint(publicJwk((ECPublicKey) pair.getPublic()));
            if (!"active".equals(payload.optString("status")) ||
                !currentThumbprint.equals(payload.optString("deviceThumbprint")))
                throw new Exception("الترخيص غير نشط أو لا يخص هذا الهاتف");
            save(context, token, payload);
            return status(context);
        } catch (LicenseApiException rejected) {
            // An explicit server denial (suspended, revoked, expired, or device proof rejected)
            // overrides the cached offline token immediately. Network failures keep the grace window.
            if (rejected.statusCode == 401 || rejected.statusCode == 403 || rejected.statusCode == 404) {
                prefs.edit().putBoolean("server_blocked", true).commit();
            }
            throw rejected;
        }
    }

    private static final long DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long VALIDATION_INTERVAL_MS = 30L * DAY_MS;
    private static final long CLOCK_SKEW_TOLERANCE_MS = 5L * 60L * 1000L;

    private static boolean clockMovedBackwards(Context context, long now, long lastValidatedAt) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long maxSeen = prefs.getLong("max_seen_wall_time", 0L);
        boolean rollback = (maxSeen > 0 && now + CLOCK_SKEW_TOLERANCE_MS < maxSeen) ||
            (lastValidatedAt > 0 && now + CLOCK_SKEW_TOLERANCE_MS < lastValidatedAt);
        if (now > maxSeen) prefs.edit().putLong("max_seen_wall_time", now).apply();
        return rollback;
    }

    static boolean shouldValidate(Context context) throws Exception {
        String token = loadToken(context);
        if (token == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean("server_blocked", false)) return true;
        JSONObject payload = verifyAndReadToken(token);
        long now = System.currentTimeMillis();
        long lastValidatedAt = payload.optLong("lastValidatedAt", 0);
        long offlineUntil = payload.optLong("offlineUntil", 0);
        long expiry = payload.optLong("expiresAt", 0);
        // Force an online check after a clock rollback or when the signed offline window
        // has elapsed. This never deletes or modifies the student's local database.
        if (lastValidatedAt <= 0 || clockMovedBackwards(context, now, lastValidatedAt)) return true;
        if (offlineUntil <= now || (expiry > 0 && expiry <= now)) return true;
        return now - lastValidatedAt >= VALIDATION_INTERVAL_MS;
    }

    static JSONObject status(Context context) throws Exception {
        String token = loadToken(context);
        if (token == null) return new JSONObject().put("hasLicense", false).put("activated", false).put("message", "لم يتم تفعيل التطبيق");
        JSONObject payload = verifyAndReadToken(token);
        long now = System.currentTimeMillis();
        long starts = payload.optLong("startsAt", 0);
        long expiry = payload.optLong("expiresAt", 0);
        long offlineUntil = payload.optLong("offlineUntil", 0);
        long lastValidatedAt = payload.optLong("lastValidatedAt", 0);
        boolean serverBlocked = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("server_blocked", false);
        boolean clockRollback = clockMovedBackwards(context, now, lastValidatedAt);
        boolean deviceMatches = deviceThumbprint(publicJwk((ECPublicKey) getOrCreateDeviceKey().getPublic()))
            .equals(payload.optString("deviceThumbprint"));
        boolean serverActive = "active".equals(payload.optString("status"));
        boolean active = serverActive && !serverBlocked && deviceMatches && !clockRollback &&
            starts <= now && (expiry == 0 || expiry > now) && offlineUntil > now;
        String message;
        if (serverBlocked) message = "أوقف المسؤول هذا الترخيص أو نُقل إلى هاتف آخر. اتصل بصاحب التطبيق.";
        else if (!deviceMatches) message = "مفتاح هذا الهاتف لا يطابق الجهاز المسجل للترخيص.";
        else if (!serverActive) message = "الترخيص غير نشط. يرجى مراجعة المسؤول.";
        else if (clockRollback) message = "تاريخ الهاتف أقدم من آخر تحقق آمن. اضبط التاريخ والوقت ثم اتصل بالإنترنت.";
        else if (starts > now) message = "لم يبدأ سريان الترخيص بعد.";
        else if (expiry > 0 && expiry <= now) message = "انتهت مدة الترخيص. بياناتك محفوظة ويمكنك تصديرها.";
        else if (offlineUntil <= now) message = "انتهت مهلة العمل دون اتصال. اتصل بالإنترنت للتحقق من الترخيص.";
        else message = "الترخيص صالح";
        return new JSONObject()
            .put("hasLicense", true)
            .put("activated", active)
            .put("licenseId", payload.optString("licenseId"))
            .put("licenseType", payload.optString("licenseType"))
            .put("startsAt", starts)
            .put("expiresAt", expiry)
            .put("durationDays", payload.optLong("durationDays", 0))
            .put("offlineUntil", offlineUntil)
            .put("lastValidatedAt", lastValidatedAt)
            .put("serverBlocked", serverBlocked)
            .put("message", message);
    }

    static boolean hasStoredLicense(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.contains("license_token_enc") || prefs.contains("license_token");
    }

    static boolean canWrite(Context context) {
        if (!hasStoredLicense(context)) return false; // No activation means no access to application services.
        try {
            return status(context).optBoolean("activated", false);
        } catch (Exception invalidLicense) {
            return false; // Fail closed for writes, never delete or overwrite the stored database.
        }
    }

    private static String loadToken(Context context) throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String encrypted = prefs.getString("license_token_enc", null);
        if (encrypted != null) {
            String ivValue = prefs.getString("license_token_iv", null);
            if (ivValue == null) throw new Exception("بيانات تخزين الترخيص المشفر غير مكتملة");
            byte[] iv = Base64.decode(ivValue, Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(encrypted, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateTokenKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        }
        // Migrate a token written by an earlier test build; never keep a plaintext copy.
        String legacy = prefs.getString("license_token", null);
        if (legacy == null) return null;
        JSONObject payload = verifyAndReadToken(legacy);
        save(context, legacy, payload);
        return legacy;
    }

    private static SecretKey getOrCreateTokenKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(TOKEN_KEY_ALIAS)) {
            return (SecretKey) store.getKey(TOKEN_KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(TOKEN_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private static void save(Context context, String token, JSONObject payload) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateTokenKey());
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        boolean ok = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("license_token_enc", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("license_token_iv", Base64.encodeToString(iv, Base64.NO_WRAP))
            .remove("license_token")
            .remove("server_blocked")
            .putString("license_id", payload.getString("licenseId"))
            .putLong("last_server_check", System.currentTimeMillis())
            .putLong("max_seen_wall_time", payload.optLong("lastValidatedAt", System.currentTimeMillis()))
            .commit();
        if (!ok) throw new Exception("تعذر حفظ بيانات الترخيص المشفر على الهاتف");
    }

    private static KeyPair getOrCreateDeviceKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            KeyStore.PrivateKeyEntry entry = (KeyStore.PrivateKeyEntry) store.getEntry(KEY_ALIAS, null);
            return new KeyPair(entry.getCertificate().getPublicKey(), entry.getPrivateKey());
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build());
        return generator.generateKeyPair();
    }

    private static JSONObject publicJwk(ECPublicKey key) throws Exception {
        byte[] x = fixed32(key.getW().getAffineX().toByteArray());
        byte[] y = fixed32(key.getW().getAffineY().toByteArray());
        return new JSONObject().put("kty", "EC").put("crv", "P-256")
            .put("x", b64url(x)).put("y", b64url(y)).put("ext", true);
    }

    private static byte[] fixed32(byte[] value) {
        int start = value.length > 32 && value[0] == 0 ? 1 : 0;
        byte[] out = new byte[32];
        int length = Math.min(32, value.length - start);
        System.arraycopy(value, value.length - length, out, 32 - length, length);
        return out;
    }

    private static String signNonce(KeyPair pair, String nonce) throws Exception {
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(pair.getPrivate());
        signer.update(nonce.getBytes(StandardCharsets.UTF_8));
        return b64url(derEcdsaToRaw(signer.sign()));
    }

    // Android emits ASN.1 DER ECDSA signatures; WebCrypto expects fixed-width r||s.
    private static byte[] derEcdsaToRaw(byte[] der) throws Exception {
        int p = 0;
        if (der[p++] != 0x30) throw new SignatureException("صيغة توقيع ECDSA غير صحيحة");
        int seqLen = der[p++] & 255;
        if (seqLen > 0x80) p += seqLen - 0x80;
        if (der[p++] != 0x02) throw new SignatureException("توقيع ECDSA غير صحيح");
        int rLen = der[p++] & 255;
        byte[] r = Arrays.copyOfRange(der, p, p + rLen); p += rLen;
        if (der[p++] != 0x02) throw new SignatureException("توقيع ECDSA غير صحيح");
        int sLen = der[p++] & 255;
        byte[] s = Arrays.copyOfRange(der, p, p + sLen);
        byte[] raw = new byte[64];
        copyInteger32(r, raw, 0);
        copyInteger32(s, raw, 32);
        return raw;
    }

    private static void copyInteger32(byte[] value, byte[] target, int offset) {
        int start = value.length > 32 && value[0] == 0 ? 1 : 0;
        int len = Math.min(32, value.length - start);
        System.arraycopy(value, value.length - len, target, offset + 32 - len, len);
    }

    private static JSONObject verifyAndReadToken(String token) throws Exception {
        String[] parts = token.split("\\.", -1);
        if (parts.length != 2) throw new Exception("صيغة الترخيص الموقّع غير صحيحة");
        byte[] der = Base64.decode(pemBody(PUBLIC_KEY_PEM), Base64.DEFAULT);
        PublicKey key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(key);
        verifier.update(parts[0].getBytes(StandardCharsets.UTF_8));
        if (!verifier.verify(Base64.decode(toBase64(parts[1]), Base64.DEFAULT)))
            throw new Exception("فشل التحقق من توقيع الترخيص");
        byte[] payloadBytes = Base64.decode(toBase64(parts[0]), Base64.DEFAULT);
        JSONObject payload = new JSONObject(new String(payloadBytes, StandardCharsets.UTF_8));
        if (!"mushrifi-license".equals(payload.optString("iss")) ||
            !"dz.mushrifi.app.offline".equals(payload.optString("aud")))
            throw new Exception("مصدر الترخيص أو التطبيق غير مطابق");
        return payload;
    }

    static String deviceId(Context context) throws Exception {
        JSONObject jwk = publicJwk((ECPublicKey) getOrCreateDeviceKey().getPublic());
        return "MSH-" + deviceThumbprint(jwk).substring(0, 24).toUpperCase(java.util.Locale.US);
    }

    private static String deviceThumbprint(JSONObject jwk) throws Exception {
        String q = String.valueOf((char) 34);
        String canonical = "{"+q+"crv"+q+":"+q+jwk.getString("crv")+q+
            ","+q+"kty"+q+":"+q+jwk.getString("kty")+q+
            ","+q+"x"+q+":"+q+jwk.getString("x")+q+
            ","+q+"y"+q+":"+q+jwk.getString("y")+q+"}";
        return hex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
    }

    private static final class LicenseApiException extends Exception {
        final int statusCode;
        LicenseApiException(String message, int statusCode) {
            super(message);
            this.statusCode = statusCode;
        }
    }

    private static JSONObject post(String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(API + path).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try {
            OutputStream out = connection.getOutputStream();
            out.write(bytes); out.close();
            int code = connection.getResponseCode();
            InputStream in = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096]; int n;
            while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
            in.close();
            JSONObject result = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            if (code < 200 || code >= 300)
                throw new LicenseApiException(result.optString("error", "رفض الخادم الطلب") + " (" + code + ")", code);
            if (!result.optBoolean("ok")) throw new Exception(result.optString("error", "فشل الطلب"));
            return result;
        } finally {
            connection.disconnect();
        }
    }

    private static String pemBody(String pem) {
        return pem.replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", "");
    }
    private static String toBase64(String url) {
        String s = url.replace('-', '+').replace('_', '/');
        while (s.length() % 4 != 0) s += "=";
        return s;
    }
    private static String b64url(byte[] data) {
        return Base64.encodeToString(data, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }
    private static String hex(byte[] data) {
        StringBuilder out = new StringBuilder();
        for (byte b : data) out.append(String.format(java.util.Locale.US, "%02x", b & 255));
        return out.toString();
    }
}
