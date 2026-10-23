package io.github.leandrocosta.remedios.health;

import io.github.leandrocosta.remedios.occurrence.OccurrenceViews.UserRef;
import io.github.leandrocosta.remedios.user.AppUser;
import io.quarkus.security.Authenticated;
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
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Aferições, sintomas e linhas de referência (docs/api.md, "Saúde"). */
@Path("/api/families/{familyId}")
@Authenticated
public class HealthResource {

    public record MeasurementView(UUID id, UUID personId, MeasurementType type, BigDecimal value, BigDecimal value2,
            String unit, String label, String method, Instant measuredAt, String notes, UserRef recordedBy,
            UUID deviceId, Instant recordedAt, Instant receivedAt, UUID replacesId, Instant voidedAt,
            UserRef voidedBy, String voidReason) {
    }

    public record SymptomView(UUID id, UUID personId, String description, SymptomRecord.Intensity intensity,
            Instant startedAt, Instant endedAt, UUID treatmentId, String notes, long version, UserRef recordedBy,
            UUID deviceId, Instant recordedAt, UserRef updatedBy, Instant updatedAt) {
    }

    public record ReferenceLineView(UUID id, UUID personId, MeasurementType type, BigDecimal value, BigDecimal value2,
            String label, Instant updatedAt) {
    }

    /** {@code id}: gerado no aparelho; reenviar o mesmo id não duplica o registro. */
    public record RecordMeasurement(
            @NotNull UUID id,
            @NotNull UUID deviceId,
            @NotNull MeasurementType type,
            @NotNull BigDecimal value,
            BigDecimal value2,
            @Size(max = 20) String unit,
            @Size(max = 80) String label,
            @Size(max = 40) String method,
            @NotNull Instant measuredAt,
            @Size(max = 1000) String notes,
            Instant recordedAt) {
    }

    public record CorrectMeasurement(
            @NotNull UUID deviceId,
            @NotNull BigDecimal value,
            BigDecimal value2,
            @Size(max = 20) String unit,
            @Size(max = 80) String label,
            @Size(max = 40) String method,
            @NotNull Instant measuredAt,
            @Size(max = 1000) String notes,
            @NotBlank @Size(max = 1000) String reason) {
    }

    public record Discard(@NotBlank @Size(max = 1000) String reason) {
    }

    public record RecordSymptom(
            @NotNull UUID id,
            @NotNull UUID deviceId,
            @NotBlank @Size(max = 200) String description,
            SymptomRecord.Intensity intensity,
            @NotNull Instant startedAt,
            Instant endedAt,
            UUID treatmentId,
            @Size(max = 1000) String notes,
            Instant recordedAt) {
    }

    public record UpdateSymptom(
            @NotNull Long baseVersion,
            @NotBlank @Size(max = 200) String description,
            SymptomRecord.Intensity intensity,
            @NotNull Instant startedAt,
            Instant endedAt,
            UUID treatmentId,
            @Size(max = 1000) String notes,
            @Size(max = 1000) String reason) {
    }

    public record SaveReferenceLine(
            UUID personId,
            @NotNull MeasurementType type,
            @NotNull BigDecimal value,
            BigDecimal value2,
            @NotBlank @Size(max = 200) String label) {
    }

    private final HealthService health;

    public HealthResource(HealthService health) {
        this.health = health;
    }

    // --- Aferições ------------------------------------------------------------

    @GET
    @Path("/persons/{personId}/measurements")
    public List<MeasurementView> measurements(@PathParam("familyId") UUID familyId,
            @PathParam("personId") UUID personId, @QueryParam("type") MeasurementType type,
            @QueryParam("from") Instant from, @QueryParam("to") Instant to) {
        return measurementViews(health.measurements(familyId, personId, type, from, to));
    }

    @POST
    @Path("/persons/{personId}/measurements")
    public Response record(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId,
            @Valid @NotNull RecordMeasurement r) {
        Measurement m = health.record(familyId, personId, new HealthService.MeasurementData(r.type(), r.value(),
                r.value2(), r.unit(), r.label(), r.method(), r.measuredAt(), r.notes()),
                new HealthService.Origin(r.id(), r.deviceId(), r.recordedAt()));
        return Response.ok(measurementViews(List.of(m)).getFirst()).build();
    }

    @GET
    @Path("/measurements/{measurementId}")
    public MeasurementView measurement(@PathParam("familyId") UUID familyId,
            @PathParam("measurementId") UUID id) {
        return measurementViews(List.of(health.measurement(familyId, id))).getFirst();
    }

    @POST
    @Path("/measurements/{measurementId}/correction")
    public MeasurementView correct(@PathParam("familyId") UUID familyId, @PathParam("measurementId") UUID id,
            @Valid @NotNull CorrectMeasurement r) {
        Measurement m = health.correct(familyId, id, new HealthService.MeasurementData(null, r.value(), r.value2(),
                r.unit(), r.label(), r.method(), r.measuredAt(), r.notes()), r.deviceId(), r.reason());
        return measurementViews(List.of(m)).getFirst();
    }

    @POST
    @Path("/measurements/{measurementId}/void")
    public Response voidMeasurement(@PathParam("familyId") UUID familyId, @PathParam("measurementId") UUID id,
            @Valid @NotNull Discard r) {
        health.voidMeasurement(familyId, id, r.reason());
        return Response.noContent().build();
    }

    // --- Sintomas -------------------------------------------------------------

    @GET
    @Path("/persons/{personId}/symptoms")
    public List<SymptomView> symptoms(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId,
            @QueryParam("from") Instant from, @QueryParam("to") Instant to) {
        return symptomViews(health.symptoms(familyId, personId, from, to));
    }

    @POST
    @Path("/persons/{personId}/symptoms")
    public SymptomView recordSymptom(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId,
            @Valid @NotNull RecordSymptom r) {
        SymptomRecord s = health.recordSymptom(familyId, personId, new HealthService.SymptomData(r.description(),
                r.intensity(), r.startedAt(), r.endedAt(), r.treatmentId(), r.notes()),
                new HealthService.Origin(r.id(), r.deviceId(), r.recordedAt()));
        return symptomViews(List.of(s)).getFirst();
    }

    @PUT
    @Path("/symptoms/{symptomId}")
    public SymptomView updateSymptom(@PathParam("familyId") UUID familyId, @PathParam("symptomId") UUID id,
            @Valid @NotNull UpdateSymptom r) {
        SymptomRecord s = health.updateSymptom(familyId, id, new HealthService.SymptomData(r.description(),
                r.intensity(), r.startedAt(), r.endedAt(), r.treatmentId(), r.notes()), r.baseVersion(), r.reason());
        return symptomViews(List.of(s)).getFirst();
    }

    @POST
    @Path("/symptoms/{symptomId}/void")
    public Response voidSymptom(@PathParam("familyId") UUID familyId, @PathParam("symptomId") UUID id,
            @Valid @NotNull Discard r) {
        health.voidSymptom(familyId, id, r.reason());
        return Response.noContent().build();
    }

    // --- Linhas de referência ---------------------------------------------------

    @GET
    @Path("/reference-lines")
    public List<ReferenceLineView> referenceLines(@PathParam("familyId") UUID familyId) {
        return health.referenceLines(familyId).stream().map(HealthResource::view).toList();
    }

    @PUT
    @Path("/reference-lines")
    public ReferenceLineView saveReferenceLine(@PathParam("familyId") UUID familyId,
            @Valid @NotNull SaveReferenceLine r) {
        return view(health.saveReferenceLine(familyId, r.personId(), r.type(), r.value(), r.value2(), r.label()));
    }

    @DELETE
    @Path("/reference-lines/{lineId}")
    public Response deleteReferenceLine(@PathParam("familyId") UUID familyId, @PathParam("lineId") UUID id) {
        health.deleteReferenceLine(familyId, id);
        return Response.noContent().build();
    }

    // --- Montagem ---------------------------------------------------------------

    private static List<MeasurementView> measurementViews(List<Measurement> list) {
        Map<UUID, AppUser> users = users(list.stream().flatMap(m -> java.util.stream.Stream.of(m.recordedBy, m.voidedBy))
                .toList());
        return list.stream().map(m -> new MeasurementView(m.id, m.personId, m.type, m.value, m.value2, m.unit,
                m.label, m.method, m.measuredAt, m.notes, ref(m.recordedBy, users), m.deviceId, m.recordedAt,
                m.receivedAt, m.replacesId, m.voidedAt, ref(m.voidedBy, users), m.voidReason)).toList();
    }

    private static List<SymptomView> symptomViews(List<SymptomRecord> list) {
        Map<UUID, AppUser> users = users(list.stream().flatMap(s -> java.util.stream.Stream.of(s.recordedBy, s.updatedBy))
                .toList());
        return list.stream().map(s -> new SymptomView(s.id, s.personId, s.description, s.intensity, s.startedAt,
                s.endedAt, s.treatmentId, s.notes, s.version, ref(s.recordedBy, users), s.deviceId, s.recordedAt,
                ref(s.updatedBy, users), s.updatedAt)).toList();
    }

    private static ReferenceLineView view(ReferenceLine r) {
        return new ReferenceLineView(r.id, r.personId, r.type, r.value, r.value2, r.label, r.updatedAt);
    }

    private static Map<UUID, AppUser> users(Collection<UUID> ids) {
        Set<UUID> distinct = new HashSet<>(ids);
        distinct.remove(null);
        if (distinct.isEmpty()) {
            return Map.of();
        }
        return AppUser.<AppUser>list("id in ?1", distinct).stream()
                .collect(Collectors.toMap(u -> u.id, Function.identity()));
    }

    private static UserRef ref(UUID id, Map<UUID, AppUser> users) {
        AppUser u = id == null ? null : users.get(id);
        return u == null ? null : new UserRef(u.id, u.displayName);
    }
}
