package io.github.leandrocosta.remedios.push;

import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.github.leandrocosta.remedios.user.Device;
import io.github.leandrocosta.remedios.user.UserNotificationSettings;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

/**
 * Push. Cada grupo de rotas tem sua classe raiz com o caminho completo: o
 * JAX-RS escolhe a raiz pelo prefixo literal mais longo (ex.: /api/me/devices).
 */
@Path("/api/push")
@Authenticated
public class PushResource {

    public record PushConfig(boolean enabled, String publicKey) {
    }

    public record Subscribe(@NotBlank @Size(max = 2000) String endpoint, @NotBlank @Size(max = 200) String p256dh,
            @NotBlank @Size(max = 100) String auth, @NotBlank @Size(max = 64) String timezone) {
    }

    public record SubscriptionView(UUID deviceId, String timezone, Instant createdAt, Instant lastSuccessAt) {
    }

    public record TestResult(int sent, int failed) {
    }

    private final PushService push;
    private final CurrentUser currentUser;

    public PushResource(PushService push, CurrentUser currentUser) {
        this.push = push;
        this.currentUser = currentUser;
    }

    /** Chave pública VAPID para o navegador criar a inscrição. */
    @GET
    @Path("/config")
    public PushConfig config() {
        return new PushConfig(push.enabled(), push.publicKey());
    }

    @Path("/api/me/devices/{deviceId}/push")
    @Authenticated
    public static class Subscriptions {

        private final PushService push;
        private final CurrentUser currentUser;

        public Subscriptions(PushService push, CurrentUser currentUser) {
            this.push = push;
            this.currentUser = currentUser;
        }

    @PUT
    @Transactional
    public SubscriptionView subscribe(@PathParam("deviceId") UUID deviceId, @Valid @NotNull Subscribe r) {
        push.requireEnabled();
        push.validateEndpoint(r.endpoint());
        try {
            ZoneId.of(r.timezone());
        } catch (DateTimeException e) {
            throw ApiException.unprocessable("INVALID_SUBSCRIPTION", "Fuso horário desconhecido.");
        }
        Device device = Device.findById(deviceId);
        if (device == null || !device.userId.equals(currentUser.id()) || device.status != Device.Status.ACTIVE) {
            throw ApiException.notFound("Aparelho");
        }
        // Um endpoint pertence a um único aparelho; uma reinstalação pode reaproveitá-lo.
        PushSubscription.delete("endpoint = ?1 and deviceId <> ?2", r.endpoint(), deviceId);
        PushSubscription s = PushSubscription.find("deviceId", deviceId).firstResult();
        if (s == null) {
            s = new PushSubscription();
            s.id = UUID.randomUUID();
            s.deviceId = deviceId;
            s.createdAt = Instant.now();
        }
        s.userId = currentUser.id();
        s.endpoint = r.endpoint();
        s.p256dh = r.p256dh();
        s.auth = r.auth();
        s.timezone = r.timezone();
        s.failures = 0;
        s.disabledAt = null;
        if (!s.isPersistent()) {
            s.persist();
        }
        return new SubscriptionView(deviceId, s.timezone, s.createdAt, s.lastSuccessAt);
    }

    @DELETE
    @Transactional
    public Response unsubscribe(@PathParam("deviceId") UUID deviceId) {
        PushSubscription.delete("deviceId = ?1 and userId = ?2", deviceId, currentUser.id());
        return Response.noContent().build();
    }
    }

    @Path("/api/me/push")
    @Authenticated
    public static class Test {

        private final PushService push;
        private final CurrentUser currentUser;

        public Test(PushService push, CurrentUser currentUser) {
            this.push = push;
            this.currentUser = currentUser;
        }

    /**
     * Envia um aviso de teste para os aparelhos do usuário, ou só para
     * {@code deviceId}: assim "enviado" quer dizer enviado a este aparelho.
     */
    @POST
    @Path("/test")
    public TestResult test(@QueryParam("deviceId") UUID deviceId) {
        push.requireEnabled();
        UUID me = currentUser.id();
        List<PushSubscription> subs = QuarkusTransaction.requiringNew().call(() -> PushSubscription.activeFor(List.of(me))
                .stream().filter(s -> deviceId == null || s.deviceId.equals(deviceId)).toList());
        if (subs.isEmpty()) {
            throw ApiException.unprocessable("NO_SUBSCRIPTION", "Ative as notificações neste aparelho primeiro.");
        }
        UserNotificationSettings prefs = QuarkusTransaction.requiringNew().call(() -> UserNotificationSettings.forUser(me));
        int sent = 0;
        for (PushSubscription s : subs) {
            PushMessage message = new PushMessage("Notificações ativadas", "Os lembretes de dose chegarão assim.",
                    "test", "/", !prefs.soundEnabled, true, Notifier.vibrate(prefs));
            if (push.send(s, message, PushService.Urgency.NORMAL, Duration.ofMinutes(10)) == PushService.Result.SENT) {
                sent++;
            }
        }
        return new TestResult(sent, subs.size() - sent);
    }
    }
}
