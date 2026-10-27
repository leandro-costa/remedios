package io.github.leandrocosta.remedios.sync;

import io.github.leandrocosta.remedios.common.ApiError;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.quarkus.hibernate.orm.panache.Panache;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.scheduler.Scheduled;
import io.vertx.core.http.HttpServerRequest;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.jboss.resteasy.reactive.server.ServerRequestFilter;
import org.jboss.resteasy.reactive.server.ServerResponseFilter;

/**
 * Idempotência de toda gravação vinda do aparelho (seção 10.1). Com o
 * cabeçalho {@code Idempotency-Key}, a primeira execução guarda status e
 * corpo da resposta; um reenvio com a mesma chave recebe a mesma resposta,
 * sem repetir os efeitos. Assim a fila offline pode reenviar qualquer
 * operação com segurança.
 *
 * <p>Erros de servidor (5xx) não são guardados: a operação pode ser tentada
 * de novo. Uma reserva que ficou presa (queda entre a execução e a gravação
 * da resposta) expira e deixa a operação ser executada outra vez.
 */
@ApplicationScoped
public class ClientOperations {

    public static final String HEADER = "Idempotency-Key";
    private static final String PROPERTY = ClientOperations.class.getName();
    private static final Set<String> WRITES = Set.of("POST", "PUT", "DELETE");
    /** Reserva de uma operação em andamento que não terminou (ex.: queda da API). */
    static final Duration STALE_RESERVATION = Duration.ofMinutes(2);
    /** Por quanto tempo o resultado fica guardado para reenvios. */
    static final Duration RETENTION = Duration.ofDays(30);

    private final CurrentUser currentUser;
    private final ObjectMapper json;

    public ClientOperations(CurrentUser currentUser, ObjectMapper json) {
        this.currentUser = currentUser;
        this.json = json;
    }

    private record Reservation(UUID userId, UUID operationId) {
    }

    private record Stored(String method, String path, Integer statusCode, String response, Instant createdAt) {
    }

    @ServerRequestFilter
    public Optional<Response> before(ContainerRequestContext request, HttpServerRequest http) {
        String key = request.getHeaderString(HEADER);
        if (key == null || !WRITES.contains(request.getMethod()) || request.getSecurityContext().getUserPrincipal() == null) {
            return Optional.empty();
        }
        UUID operationId;
        try {
            operationId = UUID.fromString(key.trim());
        } catch (IllegalArgumentException e) {
            return Optional.of(error(400, "INVALID_IDEMPOTENCY_KEY", "O cabeçalho Idempotency-Key deve ser um UUID."));
        }
        UUID userId = currentUser.id();
        String method = request.getMethod();
        String path = http.path();

        return QuarkusTransaction.requiringNew().call(() -> {
            int reserved = Panache.getEntityManager().createNativeQuery("""
                    INSERT INTO client_operation (user_id, operation_id, method, path)
                    VALUES (:user, :op, :method, :path)
                    ON CONFLICT DO NOTHING
                    """)
                    .setParameter("user", userId).setParameter("op", operationId)
                    .setParameter("method", method).setParameter("path", path)
                    .executeUpdate();
            if (reserved == 1) {
                request.setProperty(PROPERTY, new Reservation(userId, operationId));
                return Optional.<Response>empty();
            }
            Stored stored = load(userId, operationId);
            if (!stored.method().equals(method) || !stored.path().equals(path)) {
                return Optional.of(error(422, "IDEMPOTENCY_KEY_REUSED",
                        "Esta chave de operação já foi usada em outro pedido."));
            }
            if (stored.statusCode() != null) {
                Response.ResponseBuilder replay = Response.status(stored.statusCode()).header("Idempotent-Replay", "true");
                if (stored.response() != null) {
                    replay.type(MediaType.APPLICATION_JSON).entity(stored.response());
                }
                return Optional.of(replay.build());
            }
            if (stored.createdAt().isBefore(Instant.now().minus(STALE_RESERVATION))) {
                // A execução anterior não terminou; pode ser feita de novo.
                touch(userId, operationId);
                request.setProperty(PROPERTY, new Reservation(userId, operationId));
                return Optional.<Response>empty();
            }
            return Optional.of(error(409, "OPERATION_IN_PROGRESS",
                    "Esta operação ainda está sendo processada. Tente de novo em instantes."));
        });
    }

    @ServerResponseFilter
    public void after(ContainerRequestContext request, ContainerResponseContext response) {
        if (!(request.getProperty(PROPERTY) instanceof Reservation reservation)) {
            return;
        }
        int status = response.getStatus();
        QuarkusTransaction.requiringNew().run(() -> {
            if (status >= 500) {
                Panache.getEntityManager()
                        .createNativeQuery("DELETE FROM client_operation WHERE user_id = :user AND operation_id = :op")
                        .setParameter("user", reservation.userId()).setParameter("op", reservation.operationId())
                        .executeUpdate();
                return;
            }
            Panache.getEntityManager().createNativeQuery("""
                    UPDATE client_operation SET status_code = :status, response = :body, completed_at = now()
                    WHERE user_id = :user AND operation_id = :op
                    """)
                    .setParameter("status", status).setParameter("body", body(response.getEntity()))
                    .setParameter("user", reservation.userId()).setParameter("op", reservation.operationId())
                    .executeUpdate();
        });
    }

    /** Apaga resultados antigos uma vez por dia. */
    @Scheduled(identity = "operacoes-antigas", every = "24h", delayed = "1m")
    void purge() {
        QuarkusTransaction.requiringNew().run(() -> Panache.getEntityManager()
                .createNativeQuery("DELETE FROM client_operation WHERE created_at < :limit")
                .setParameter("limit", Instant.now().minus(RETENTION))
                .executeUpdate());
    }

    private static Stored load(UUID userId, UUID operationId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = Panache.getEntityManager().createNativeQuery("""
                SELECT method, path, status_code, response, created_at FROM client_operation
                WHERE user_id = :user AND operation_id = :op
                """)
                .setParameter("user", userId).setParameter("op", operationId)
                .getResultList();
        Object[] row = rows.getFirst();
        Instant createdAt = row[4] instanceof java.time.OffsetDateTime o ? o.toInstant() : (Instant) row[4];
        return new Stored((String) row[0], (String) row[1], row[2] == null ? null : ((Number) row[2]).intValue(),
                (String) row[3], createdAt);
    }

    private static void touch(UUID userId, UUID operationId) {
        Panache.getEntityManager()
                .createNativeQuery("UPDATE client_operation SET created_at = now() WHERE user_id = :user AND operation_id = :op")
                .setParameter("user", userId).setParameter("op", operationId)
                .executeUpdate();
    }

    private String body(Object entity) {
        if (entity == null) {
            return null;
        }
        if (entity instanceof String text) {
            return text;
        }
        try {
            return json.writeValueAsString(entity);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Resposta não serializável para a operação idempotente.", e);
        }
    }

    private static Response error(int status, String code, String message) {
        return Response.status(status).type(MediaType.APPLICATION_JSON).entity(new ApiError(code, message, null)).build();
    }
}
