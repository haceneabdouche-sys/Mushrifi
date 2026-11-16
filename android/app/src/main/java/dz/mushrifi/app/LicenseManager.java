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
import java.security.spec.InvalidKeySpecException;
import java.security.interfaces.RSAPublicKey;
import java.security.Signature;
import java.util.Arrays;

import javax.crypto.Cipher;

/**
 * Native Mushrifi licensing foundation.
 * Device private key never leaves Android Keystore.
 * The server signing private key is never included in this app.
 */
final class LicenseManager {
    private static final String API = "https://mushrifi-license-server.hacene47211.workers.dev";
    private static final String KEY_ALIAS = "mushrifi_device_license_ec";
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
        if (!"active".equals(payload.optString("status")))
            throw new Exception("الترخيص غير نشط");
        save(context, token, payload);
        return status(context);
    }

    static JSONObject status(Context context) throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = prefs.getString("license_token", null);
        if (token == null) return new JSONObject().put("activated", false).put("message", "لم يتم تفعيل التطبيق");
        JSONObject payload = verifyAndReadToken(token);
        long now = System.currentTimeMillis();
        long starts = payload.optLong("startsAt", 0);
        long expiry = payload.optLong("expiresAt", 0);
        long offlineUntil = payload.optLong("offlineUntil", 0);
        boolean deviceMatches = deviceThumbprint(publicJwk((ECPublicKey) getOrCreateDeviceKey().getPublic()))
            .equals(payload.optString("deviceThumbprint"));
        boolean active = "active".equals(payload.optString("status")) && deviceMatches &&
            starts <= now && (expiry == 0 || expiry > now) && offlineUntil > now;
        return new JSONObject()
            .put("activated", active)
            .put("licenseId", payload.optString("licenseId"))
            .put("licenseType", payload.optString("licenseType"))
            .put("expiresAt", expiry)
            .put("offlineUntil", offlineUntil)
            .put("message", active ? "الترخيص صالح" : "يلزم الاتصال بالخادم للتحقق من الترخيص");
    }

    private static void save(Context context, String token, JSONObject payload) throws Exception {
        boolean ok = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("license_token", token)
            .putString("license_id", payload.getString("licenseId"))
            .putLong("last_server_check", System.currentTimeMillis())
            .commit();
        if (!ok) throw new Exception("تعذر حفظ بيانات الترخيص على الهاتف");
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

    private static String deviceThumbprint(JSONObject jwk) throws Exception {
        String canonical = new JSONObject().put("crv", jwk.getString("crv"))
            .put("kty", jwk.getString("kty")).put("x", jwk.getString("x"))
            .put("y", jwk.getString("y")).toString();
        return hex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
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
                throw new Exception(result.optString("error", "رفض الخادم الطلب") + " (" + code + ")");
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
