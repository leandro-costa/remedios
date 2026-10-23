package io.github.leandrocosta.remedios.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.leandrocosta.remedios.common.ApiException;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Envio Web Push (RFC 8030) com cifra RFC 8291 e VAPID. A entrega não é
 * garantida (seção 11.3): o estado compartilhado continua no servidor e o app
 * se atualiza ao abrir.
 */
@ApplicationScoped
public class PushService {

    public enum Urgency { NORMAL, HIGH }

    public enum Result { SENT, GONE, FAILED }

    private static final Logger LOG = Logger.getLogger(PushService.class);
    /** Falhas seguidas antes de desativar uma inscrição. */
    private static final int MAX_FAILURES = 20;

    private final ObjectMapper mapper;
    private final boolean allowInsecure;
    private final Vapid vapid;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public PushService(ObjectMapper mapper,
            @ConfigProperty(name = "remedios.push.vapid.public-key") Optional<String> publicKey,
            @ConfigProperty(name = "remedios.push.vapid.private-key") Optional<String> privateKey,
            @ConfigProperty(name = "remedios.push.vapid.subject") String subject,
            @ConfigProperty(name = "remedios.push.allow-insecure-endpoints", defaultValue = "false") boolean allowInsecure)
            throws GeneralSecurityException {
        this.mapper = mapper;
        this.allowInsecure = allowInsecure;
        if (publicKey.filter(k -> !k.isBlank()).isPresent() && privateKey.filter(k -> !k.isBlank()).isPresent()) {
            this.vapid = new Vapid(publicKey.get().strip(), privateKey.get().strip(), subject);
        } else {
            this.vapid = null;
            LOG.warn("Push desativado: defina REMEDIOS_VAPID_PUBLIC_KEY e REMEDIOS_VAPID_PRIVATE_KEY "
                    + "(scripts/vapid-keys.sh). Os lembretes não serão enviados.");
        }
    }

    public boolean enabled() {
        return vapid != null;
    }

    public String publicKey() {
        return vapid == null ? null : vapid.publicKey();
    }

    public void requireEnabled() {
        if (vapid == null) {
            throw new ApiException(503, "PUSH_NOT_CONFIGURED", "As notificações não estão configuradas neste servidor.");
        }
    }

    /** Endpoint aceitável: HTTPS (HTTP só quando liberado, nos testes). */
    public void validateEndpoint(String endpoint) {
        URI uri;
        try {
            uri = URI.create(endpoint);
        } catch (IllegalArgumentException e) {
            throw ApiException.unprocessable("INVALID_SUBSCRIPTION", "Endereço de push inválido.");
        }
        if (!"https".equals(uri.getScheme()) && !(allowInsecure && "http".equals(uri.getScheme()))) {
            throw ApiException.unprocessable("INVALID_SUBSCRIPTION", "O endereço de push precisa ser HTTPS.");
        }
    }

    /**
     * Envia fora de transação (não segura bloqueios do banco durante a rede) e
     * registra o resultado na inscrição.
     */
    public Result send(PushSubscription subscription, PushMessage message, Urgency urgency, Duration ttl) {
        if (vapid == null) {
            return Result.FAILED;
        }
        Result result;
        try {
            URI endpoint = URI.create(subscription.endpoint);
            byte[] body = WebPushCrypto.encrypt(mapper.writeValueAsBytes(message),
                    WebPushCrypto.b64(subscription.p256dh), WebPushCrypto.b64(subscription.auth));
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Encoding", "aes128gcm")
                    .header("Content-Type", "application/octet-stream")
                    .header("TTL", String.valueOf(ttl.toSeconds()))
                    .header("Urgency", urgency == Urgency.HIGH ? "high" : "normal")
                    .header("Authorization", vapid.authorization(endpoint, Instant.now()))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
            int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            result = status >= 200 && status < 300 ? Result.SENT : status == 404 || status == 410 ? Result.GONE
                    : Result.FAILED;
            if (result == Result.FAILED) {
                LOG.debugf("Push recusado (%d) para a inscrição %s", status, subscription.id);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            result = Result.FAILED;
        } catch (Exception e) {
            LOG.debugf(e, "Falha ao enviar push para a inscrição %s", subscription.id);
            result = Result.FAILED;
        }
        record(subscription.id, result);
        return result;
    }

    private void record(UUID subscriptionId, Result result) {
        QuarkusTransaction.requiringNew().run(() -> {
            PushSubscription s = PushSubscription.findById(subscriptionId);
            if (s == null) {
                return;
            }
            switch (result) {
                case SENT -> {
                    s.lastSuccessAt = Instant.now();
                    s.failures = 0;
                }
                case GONE -> s.disabledAt = Instant.now();
                case FAILED -> {
                    s.failures++;
                    if (s.failures >= MAX_FAILURES) {
                        s.disabledAt = Instant.now();
                    }
                }
            }
        });
    }
}
