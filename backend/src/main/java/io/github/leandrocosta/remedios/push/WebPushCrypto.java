package io.github.leandrocosta.remedios.push;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Cifra de mensagens Web Push (RFC 8291, "aes128gcm" da RFC 8188) só com o
 * JDK: ECDH P-256, HKDF-SHA-256 e AES-128-GCM, num único registro.
 */
public final class WebPushCrypto {

    private static final int RECORD_SIZE = 4096;
    private static final SecureRandom RANDOM = new SecureRandom();
    static final ECParameterSpec P256;

    static {
        try {
            AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
            params.init(new ECGenParameterSpec("secp256r1"));
            P256 = params.getParameterSpec(ECParameterSpec.class);
        } catch (GeneralSecurityException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private WebPushCrypto() {
    }

    /** Cifra para a inscrição (chave p256dh e segredo auth do navegador), com chave efêmera e sal novos. */
    public static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret) {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(P256, RANDOM);
            byte[] salt = new byte[16];
            RANDOM.nextBytes(salt);
            return encrypt(plaintext, uaPublic, authSecret, generator.generateKeyPair(), salt);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, KeyPair asKeys, byte[] salt)
            throws GeneralSecurityException {
        byte[] asPublic = rawPublic((ECPublicKey) asKeys.getPublic());
        byte[] secret = ecdh((ECPrivateKey) asKeys.getPrivate(), publicKey(uaPublic));
        Keys k = deriveKeys(secret, authSecret, uaPublic, asPublic, salt);

        byte[] padded = Arrays.copyOf(plaintext, plaintext.length + 1);
        padded[plaintext.length] = 0x02; // delimitador do último registro
        if (padded.length + 16 > RECORD_SIZE) {
            throw new IllegalArgumentException("Mensagem grande demais para o push.");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(k.cek, "AES"), new GCMParameterSpec(128, k.nonce));
        byte[] ciphertext = cipher.doFinal(padded);

        ByteBuffer body = ByteBuffer.allocate(16 + 4 + 1 + asPublic.length + ciphertext.length);
        body.put(salt).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic).put(ciphertext);
        return body.array();
    }

    /** Decifra como o navegador faria. Usado nos testes. */
    public static byte[] decrypt(byte[] body, ECPrivateKey uaPrivate, byte[] uaPublic, byte[] authSecret)
            throws GeneralSecurityException {
        ByteBuffer in = ByteBuffer.wrap(body);
        byte[] salt = new byte[16];
        in.get(salt);
        in.getInt();
        byte[] asPublic = new byte[in.get() & 0xff];
        in.get(asPublic);
        byte[] ciphertext = new byte[in.remaining()];
        in.get(ciphertext);

        Keys k = deriveKeys(ecdh(uaPrivate, publicKey(asPublic)), authSecret, uaPublic, asPublic, salt);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(k.cek, "AES"), new GCMParameterSpec(128, k.nonce));
        byte[] padded = cipher.doFinal(ciphertext);
        int end = padded.length - 1;
        while (end >= 0 && padded[end] == 0) {
            end--;
        }
        if (end < 0 || padded[end] != 0x02) {
            throw new GeneralSecurityException("Delimitador ausente.");
        }
        return Arrays.copyOf(padded, end);
    }

    private record Keys(byte[] cek, byte[] nonce) {
    }

    private static Keys deriveKeys(byte[] ecdhSecret, byte[] authSecret, byte[] uaPublic, byte[] asPublic, byte[] salt)
            throws GeneralSecurityException {
        ByteArrayOutputStream keyInfo = new ByteArrayOutputStream();
        keyInfo.writeBytes("WebPush: info".getBytes(StandardCharsets.US_ASCII));
        keyInfo.write(0);
        keyInfo.writeBytes(uaPublic);
        keyInfo.writeBytes(asPublic);
        byte[] ikm = hkdf(authSecret, ecdhSecret, keyInfo.toByteArray(), 32);
        byte[] prk = hmac(salt, ikm);
        byte[] cek = expand(prk, info("Content-Encoding: aes128gcm"), 16);
        byte[] nonce = expand(prk, info("Content-Encoding: nonce"), 12);
        return new Keys(cek, nonce);
    }

    private static byte[] info(String label) {
        byte[] text = label.getBytes(StandardCharsets.US_ASCII);
        return Arrays.copyOf(text, text.length + 1);
    }

    private static byte[] hkdf(byte[] salt, byte[] ikm, byte[] info, int length) throws GeneralSecurityException {
        return expand(hmac(salt, ikm), info, length);
    }

    /** HKDF-Expand com um único bloco (length ≤ 32). */
    private static byte[] expand(byte[] prk, byte[] info, int length) throws GeneralSecurityException {
        byte[] input = Arrays.copyOf(info, info.length + 1);
        input[info.length] = 0x01;
        return Arrays.copyOf(hmac(prk, input), length);
    }

    private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static byte[] ecdh(ECPrivateKey privateKey, ECPublicKey publicKey) throws GeneralSecurityException {
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(privateKey);
        agreement.doPhase(publicKey, true);
        return agreement.generateSecret();
    }

    // --- Conversão de chaves (formato "cru" usado pelos navegadores) ---------------

    /** Ponto não comprimido (0x04 || X || Y, 65 bytes) → chave pública. */
    public static ECPublicKey publicKey(byte[] raw) throws GeneralSecurityException {
        if (raw.length != 65 || raw[0] != 0x04) {
            throw new GeneralSecurityException("Chave pública P-256 inválida.");
        }
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(raw, 1, 33));
        BigInteger y = new BigInteger(1, Arrays.copyOfRange(raw, 33, 65));
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), P256));
    }

    /** Escalar de 32 bytes → chave privada. */
    public static ECPrivateKey privateKey(byte[] raw) throws GeneralSecurityException {
        return (ECPrivateKey) KeyFactory.getInstance("EC")
                .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, raw), P256));
    }

    public static byte[] rawPublic(ECPublicKey key) {
        byte[] raw = new byte[65];
        raw[0] = 0x04;
        copyUnsigned(key.getW().getAffineX(), raw, 1);
        copyUnsigned(key.getW().getAffineY(), raw, 33);
        return raw;
    }

    static void copyUnsigned(BigInteger value, byte[] target, int offset) {
        byte[] bytes = value.toByteArray();
        int start = bytes.length > 32 ? bytes.length - 32 : 0;
        int length = bytes.length - start;
        System.arraycopy(bytes, start, target, offset + 32 - length, length);
    }

    public static byte[] b64(String base64Url) {
        return Base64.getUrlDecoder().decode(base64Url.replace("=", ""));
    }

    public static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
