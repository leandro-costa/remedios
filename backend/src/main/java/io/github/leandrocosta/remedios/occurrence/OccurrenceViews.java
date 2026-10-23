package io.github.leandrocosta.remedios.occurrence;

import io.github.leandrocosta.remedios.audit.AuditEvent;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.schedule.TreatmentSchedule;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.user.AppUser;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Monta as respostas de ocorrências, carregando os dados relacionados em lote. */
@ApplicationScoped
public class OccurrenceViews {

    public record PersonRef(UUID id, String displayName) {
    }

    public record TreatmentRef(UUID id, String name, String prescribedDose, String route) {
    }

    public record UserRef(UUID id, String displayName) {
    }

    public record AdministrationView(UUID id, Instant administeredAt, Instant recordedAt, Instant receivedAt,
            UserRef recordedBy, UUID deviceId, String notes, Instant voidedAt, UserRef voidedBy,
            String voidReason) {
    }

    /**
     * {@code status}: estado da dose, com {@code PENDING} calculado para doses
     * em aberto cujo horário já chegou. {@code late}: em aberto além da
     * tolerância da agenda (classificação operacional, não orientação clínica).
     */
    public record OccurrenceView(UUID id, Instant scheduledAt, DoseOccurrence.Status status, boolean late,
            long version, PersonRef person, TreatmentRef treatment, AdministrationView administration,
            String statusReason, UserRef statusChangedBy, Instant statusChangedAt) {
    }

    public record TrailEntry(String eventType, UserRef actor, Instant occurredAt, String reason,
            Map<String, Object> before, Map<String, Object> after) {
    }

    public record OccurrenceDetail(OccurrenceView occurrence, List<AdministrationView> records,
            List<TrailEntry> trail) {
    }

    public List<OccurrenceView> of(List<DoseOccurrence> occurrences) {
        Instant now = Instant.now();
        Map<UUID, Treatment> treatments = byId(Treatment.class,
                occurrences.stream().map(o -> o.treatmentId).collect(Collectors.toSet()), t -> t.id);
        Map<UUID, Person> persons = byId(Person.class,
                treatments.values().stream().map(t -> t.personId).collect(Collectors.toSet()), p -> p.id);
        Map<UUID, TreatmentSchedule> schedules = byId(TreatmentSchedule.class,
                occurrences.stream().map(o -> o.scheduleId).collect(Collectors.toSet()), s -> s.id);
        Map<UUID, AdministrationRecord> records = AdministrationRecord
                .listValid(occurrences.stream().map(o -> o.id).toList()).stream()
                .collect(Collectors.toMap(r -> r.doseOccurrenceId, Function.identity()));
        Map<UUID, AppUser> users = users(Stream.concat(
                occurrences.stream().map(o -> o.statusChangedBy),
                records.values().stream().map(r -> r.recordedBy)).toList());

        return occurrences.stream().map(o -> {
            Treatment t = treatments.get(o.treatmentId);
            Person p = persons.get(t.personId);
            TreatmentSchedule s = schedules.get(o.scheduleId);
            boolean open = o.isOpen();
            DoseOccurrence.Status status = open && !now.isBefore(o.scheduledAt) ? DoseOccurrence.Status.PENDING
                    : o.status;
            boolean late = open && now.isAfter(o.scheduledAt.plus(Duration.ofMinutes(s.lateToleranceMinutes)));
            AdministrationRecord r = records.get(o.id);
            return new OccurrenceView(o.id, o.scheduledAt, status, late, o.version,
                    new PersonRef(p.id, p.displayName),
                    new TreatmentRef(t.id, t.name, t.prescribedDose, t.route),
                    r == null ? null : administration(r, users),
                    o.statusReason, ref(o.statusChangedBy, users), o.statusChangedAt);
        }).toList();
    }

    public OccurrenceDetail detail(DoseOccurrence occurrence) {
        List<AdministrationRecord> records = AdministrationRecord.listAll(occurrence.id);
        List<AuditEvent> events = AuditEvent.list(
                "entityType = ?1 and entityId = ?2 order by occurredAt, receivedAt",
                OccurrenceService.ENTITY, occurrence.id);
        Map<UUID, AppUser> users = users(Stream.concat(
                records.stream().flatMap(r -> Stream.of(r.recordedBy, r.voidedBy)),
                events.stream().map(e -> e.actorId)).toList());
        return new OccurrenceDetail(of(List.of(occurrence)).getFirst(),
                records.stream().map(r -> administration(r, users)).toList(),
                events.stream().map(e -> new TrailEntry(e.eventType, ref(e.actorId, users), e.occurredAt, e.reason,
                        e.beforeData, e.afterData)).toList());
    }

    private static AdministrationView administration(AdministrationRecord r, Map<UUID, AppUser> users) {
        return new AdministrationView(r.id, r.administeredAt, r.recordedAt, r.receivedAt, ref(r.recordedBy, users),
                r.deviceId, r.notes, r.voidedAt, ref(r.voidedBy, users), r.voidReason);
    }

    private static UserRef ref(UUID id, Map<UUID, AppUser> users) {
        AppUser u = id == null ? null : users.get(id);
        return u == null ? null : new UserRef(u.id, u.displayName);
    }

    private static Map<UUID, AppUser> users(Collection<UUID> ids) {
        Set<UUID> distinct = new HashSet<>(ids);
        distinct.remove(null);
        return byId(AppUser.class, distinct, u -> u.id);
    }

    private static <T> Map<UUID, T> byId(Class<T> type, Set<UUID> ids, Function<T, UUID> id) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return io.quarkus.hibernate.orm.panache.Panache.getEntityManager()
                .createQuery("from " + type.getSimpleName() + " e where e.id in :ids", type)
                .setParameter("ids", ids)
                .getResultList().stream()
                .collect(Collectors.toMap(id, Function.identity()));
    }
}
