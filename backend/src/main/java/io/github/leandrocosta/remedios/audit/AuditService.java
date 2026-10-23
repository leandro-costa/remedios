package io.github.leandrocosta.remedios.audit;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Grava auditoria e eventos de outbox. Exige uma transação em andamento: os
 * registros só existem se a alteração que os originou for confirmada.
 */
@ApplicationScoped
public class AuditService {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    private final ObjectMapper mapper;

    public AuditService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Transactional(Transactional.TxType.MANDATORY)
    public AuditEvent record(UUID familyId, UUID actorId, String entityType, UUID entityId, String eventType,
            Object before, Object after, String reason) {
        Instant now = Instant.now();
        AuditEvent event = new AuditEvent();
        event.id = UUID.randomUUID();
        event.familyId = familyId;
        event.actorId = actorId;
        event.entityType = entityType;
        event.entityId = entityId;
        event.eventType = eventType;
        event.beforeData = toMap(before);
        event.afterData = toMap(after);
        event.reason = reason;
        event.occurredAt = now;
        event.receivedAt = now;
        event.persist();
        return event;
    }

    @Transactional(Transactional.TxType.MANDATORY)
    public OutboxEvent publish(UUID familyId, String eventType, String aggregateType, UUID aggregateId,
            Object payload) {
        Instant now = Instant.now();
        OutboxEvent event = new OutboxEvent();
        event.id = UUID.randomUUID();
        event.familyId = familyId;
        event.eventType = eventType;
        event.aggregateType = aggregateType;
        event.aggregateId = aggregateId;
        event.payload = toMap(payload);
        event.status = OutboxEvent.Status.PENDING;
        event.attempts = 0;
        event.nextAttemptAt = now;
        event.createdAt = now;
        event.persist();
        return event;
    }

    private Map<String, Object> toMap(Object value) {
        return value == null ? null : mapper.convertValue(value, MAP);
    }
}
