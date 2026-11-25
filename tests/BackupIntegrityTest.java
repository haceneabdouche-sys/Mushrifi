package dz.mushrifi.app;

public final class BackupIntegrityTest {
    private static void expect(String label, String input, String expected) {
        String actual = BackupIntegrity.sha256Hex(input);
        if (!expected.equals(actual)) {
            throw new AssertionError(label + " SHA-256 mismatch: " + actual);
        }
    }

    public static void main(String[] args) {
        expect("empty", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        expect("ASCII", "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        expect("Arabic UTF-8", "مُشرِفي", "8cee3fe390c95b305a7f8db90ab13d6363cd8090a18c4ad53b7c9b568a44fdfb");
        expect("Arabic JSON", "{\"name\":\"عبدوش\",\"note\":\"غياب صباحي\"}",
            "6c0d4a6cb70785217115228162102bcb1128fb9ff56394af72d439d8112a8b3a");
        System.out.println("PASS: native SHA-256 matches standard ASCII and Arabic UTF-8 test vectors.");
    }
}
