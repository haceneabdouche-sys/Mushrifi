package dz.mushrifi.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Small, platform-independent integrity helper for Mushrifi backup payloads.
 * SHA-256 is an unkeyed digest: it detects accidental changes but is not a
 * digital signature and does not authenticate who created a backup.
 */
public final class BackupIntegrity {
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private BackupIntegrity() {}

    public static String sha256Hex(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Backup payload must not be null.");
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            char[] result = new char[digest.length * 2];
            for (int i = 0; i < digest.length; i++) {
                int b = digest[i] & 0xff;
                result[i * 2] = HEX[b >>> 4];
                result[i * 2 + 1] = HEX[b & 0x0f];
            }
            return new String(result);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable on this device.", error);
        }
    }
}
