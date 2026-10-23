package io.github.leandrocosta.remedios.push;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.time.Duration;
import java.time.Instant;

/** Identificação do servidor junto ao serviço de push (VAPID, RFC 8292): JWT ES256. */
public final class Vapid {

    private final ECPrivateKey privateKey;
    private final String publicKey;
    private final String subject;

    /**
     * @param publicKey  chave pública crua (65 bytes), em base64url
     * @param privateKey escalar privado (32 bytes), em base64url
     * @param subject    contato do responsável pelo servidor (mailto: ou https:)
     */
    public Vapid(String publicKey, String privateKey, String subject) throws GeneralSecurityException {
        this.privateKey = WebPushCrypto.privateKey(WebPushCrypto.b64(privateKey));
        WebPushCrypto.publicKey(WebPushCrypto.b64(publicKey));
        this.publicKey = publicKey;
        this.subject = subject;
    }

    public String publicKey() {
        return publicKey;
    }

    /** Cabeçalho Authorization para o endpoint. */
    public String authorization(URI endpoint, Instant now) throws GeneralSecurityException {
        String audience = endpoint.getScheme() + "://" + endpoint.getRawAuthority();
        long exp = now.plus(Duration.ofHours(12)).getEpochSecond();
        String header = WebPushCrypto.b64("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = WebPushCrypto.b64(("{\"aud\":\"" + audience + "\",\"exp\":" + exp + ",\"sub\":\"" + subject + "\"}")
                .getBytes(StandardCharsets.UTF_8));
        Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
        signer.initSign(privateKey);
        signer.update((header + "." + claims).getBytes(StandardCharsets.US_ASCII));
        String jwt = header + "." + claims + "." + WebPushCrypto.b64(signer.sign());
        return "vapid t=" + jwt + ", k=" + publicKey;
    }
}
