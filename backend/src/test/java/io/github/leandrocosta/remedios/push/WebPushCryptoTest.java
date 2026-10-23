package io.github.leandrocosta.remedios.push;

import static io.github.leandrocosta.remedios.push.WebPushCrypto.b64;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class WebPushCryptoTest {

    /** Exemplo do Apêndice A da RFC 8291. */
    @Test
    void matchesTheRfc8291Example() throws Exception {
        byte[] plaintext = "When I grow up, I want to be a watermelon".getBytes(StandardCharsets.UTF_8);
        byte[] asPrivate = b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
        byte[] asPublic = b64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
        byte[] uaPublic = b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
        byte[] uaPrivate = b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94");
        byte[] salt = b64("DGv6ra1nlYgDCS1FRnbzlw");
        byte[] auth = b64("BTBZMqHH6r4Tts7J_aSIgg");
        String expected = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

        KeyPair asKeys = new KeyPair(WebPushCrypto.publicKey(asPublic), WebPushCrypto.privateKey(asPrivate));
        byte[] body = WebPushCrypto.encrypt(plaintext, uaPublic, auth, asKeys, salt);

        assertEquals(expected, b64(body));
        assertArrayEquals(plaintext, WebPushCrypto.decrypt(body, WebPushCrypto.privateKey(uaPrivate), uaPublic, auth));
    }

    @Test
    void roundTripWithFreshKeys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(WebPushCrypto.P256);
        KeyPair browser = generator.generateKeyPair();
        byte[] uaPublic = WebPushCrypto.rawPublic((ECPublicKey) browser.getPublic());
        byte[] auth = new byte[16];
        byte[] message = "{\"title\":\"Dose às 08:00\"}".getBytes(StandardCharsets.UTF_8);

        byte[] body = WebPushCrypto.encrypt(message, uaPublic, auth);
        assertArrayEquals(message, WebPushCrypto.decrypt(body, (ECPrivateKey) browser.getPrivate(), uaPublic, auth));
    }

    @Test
    void vapidTokenIsAValidEs256Jwt() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(WebPushCrypto.P256);
        KeyPair server = generator.generateKeyPair();
        byte[] scalar = new byte[32];
        WebPushCrypto.copyUnsigned(((ECPrivateKey) server.getPrivate()).getS(), scalar, 0);
        String publicKey = b64(WebPushCrypto.rawPublic((ECPublicKey) server.getPublic()));
        Vapid vapid = new Vapid(publicKey, b64(scalar), "mailto:familia@example.com");

        String header = vapid.authorization(URI.create("https://push.example.net/send/abc"), Instant.ofEpochSecond(1_000));
        assertTrue(header.startsWith("vapid t="));
        assertTrue(header.endsWith(", k=" + publicKey));
        String jwt = header.substring("vapid t=".length(), header.indexOf(','));
        String[] parts = jwt.split("\\.");
        String claims = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
        assertEquals("{\"aud\":\"https://push.example.net\",\"exp\":44200,\"sub\":\"mailto:familia@example.com\"}", claims);

        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(server.getPublic());
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertTrue(verifier.verify(Base64.getUrlDecoder().decode(parts[2])));
    }
}
