package io.github.leandrocosta.remedios.treatment;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.schedule.ScheduleRule;
import io.github.leandrocosta.remedios.sync.ClientOperations;
import io.github.leandrocosta.remedios.sync.SyncConflict;
import io.github.leandrocosta.remedios.sync.SyncConflictChange;
import io.github.leandrocosta.remedios.sync.SyncOperation;
import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Path("/api/families/{familyId}/treatments")
@Authenticated
public class TreatmentResource {

    /** {@code conflictId}: alteração feita offline aguardando conferência (seção 10.2). */
    public record TreatmentView(UUID id, UUID personId, String name, Treatment.Kind kind, String prescribedDose,
            String route, String instructions, Treatment.Status status, Instant startAt, Instant endAt,
            Map<String, Object> schedule, long version, UUID createdBy, Instant createdAt, UUID updatedBy,
            Instant updatedAt, UUID conflictId) {

        static TreatmentView of(Treatment t, UUID conflictId) {
            return new TreatmentView(t.id, t.personId, t.name, t.kind, t.prescribedDose, t.route, t.instructions,
                    t.status, t.startAt, t.endAt, t.scheduleRule, t.version, t.createdBy, t.createdAt, t.updatedBy,
                    t.updatedAt, conflictId);
        }

        static TreatmentView of(Treatment t) {
            return of(t, SyncConflict.findOpen(TreatmentService.TREATMENT, t.id).map(c -> c.id).orElse(null));
        }
    }

    /** Alteração preservada para conferência: resposta 202 de uma alteração vinda da fila offline. */
    public record InReview(String status, UUID conflictId, TreatmentView treatment) {
    }

    public record ProposalView(UUID id, String action, UUID proposedBy, UUID deviceId, Long baseVersion,
            Map<String, Object> data, Instant createdAt) {
    }

    public record ConflictView(UUID id, String reason, Long baseVersion, Instant createdAt, TreatmentView treatment,
            List<ProposalView> proposals) {
    }

    public record Resolve(@NotNull UUID conflictId, @NotNull TreatmentService.Choice choice, UUID proposalId,
            @NotNull Long baseVersion, @NotBlank @Size(max = 1000) String reason) {
    }

    public record RevisionView(long version, Long baseVersion, Map<String, Object> snapshot, Instant effectiveFrom,
            String changeReason, UUID createdBy, Instant createdAt) {

        static RevisionView of(TreatmentRevision r) {
            return new RevisionView(r.version, r.baseVersion, r.snapshot, r.effectiveFrom, r.changeReason,
                    r.createdBy, r.createdAt);
        }
    }

    public record CreateTreatment(
            /** Id gerado no aparelho (opcional). */
            UUID id,
            @NotNull UUID personId,
            @NotBlank @Size(max = 200) String name,
            @NotNull Treatment.Kind kind,
            @NotBlank @Size(max = 500) String prescribedDose,
            @Size(max = 200) String route,
            @Size(max = 4000) String instructions,
            @NotNull Instant startAt,
            Instant endAt,
            ScheduleRule schedule) {

        TreatmentService.TreatmentData toData() {
            return new TreatmentService.TreatmentData(name, kind, prescribedDose, route, instructions, startAt,
                    endAt, schedule);
        }
    }

    /** Alteração completa do conteúdo, com versão-base, vigência e motivo (seção 4.5). */
    public record UpdateTreatment(
            @NotBlank @Size(max = 200) String name,
            @NotNull Treatment.Kind kind,
            @NotBlank @Size(max = 500) String prescribedDose,
            @Size(max = 200) String route,
            @Size(max = 4000) String instructions,
            @NotNull Instant startAt,
            Instant endAt,
            ScheduleRule schedule,
            @NotNull Long baseVersion,
            @NotNull Instant effectiveFrom,
            @Size(max = 1000) String reason,
            /** Fila offline: preservar como conflito se a versão-base estiver desatualizada. */
            Boolean preserveConflict,
            UUID deviceId) {
    }

    public record ChangeStatus(
            @NotNull Treatment.Status status,
            @NotNull Long baseVersion,
            Instant effectiveFrom,
            @Size(max = 1000) String reason,
            /** Ao ativar um rascunho que começou no passado: o que fazer com as doses anteriores. */
            TreatmentService.PastDoses pastDoses,
            UUID deviceId,
            Boolean preserveConflict) {
    }

    private final TreatmentService treatments;
    private final ObjectMapper json;

    public TreatmentResource(TreatmentService treatments, ObjectMapper json) {
        this.treatments = treatments;
        this.json = json;
    }

    @GET
    public List<TreatmentView> list(@PathParam("familyId") UUID familyId, @QueryParam("personId") UUID personId,
            @QueryParam("status") Treatment.Status status) {
        Map<UUID, UUID> inReview = treatments.openConflicts(familyId);
        return treatments.list(familyId, personId, status).stream()
                .map(t -> TreatmentView.of(t, inReview.get(t.id))).toList();
    }

    @POST
    public Response create(@PathParam("familyId") UUID familyId, @Valid @NotNull CreateTreatment request) {
        Treatment t = treatments.create(familyId, request.id(), request.personId(), request.toData());
        return Response.status(Response.Status.CREATED).entity(TreatmentView.of(t)).build();
    }

    @GET
    @Path("/{treatmentId}")
    public TreatmentView get(@PathParam("familyId") UUID familyId, @PathParam("treatmentId") UUID treatmentId) {
        return TreatmentView.of(treatments.get(familyId, treatmentId));
    }

    @PUT
    @Path("/{treatmentId}")
    public Response update(@PathParam("familyId") UUID familyId, @PathParam("treatmentId") UUID treatmentId,
            @HeaderParam(ClientOperations.HEADER) String operationKey, @Valid @NotNull UpdateTreatment r) {
        TreatmentService.Outcome outcome = treatments.update(familyId, treatmentId,
                new TreatmentService.TreatmentData(r.name(), r.kind(), r.prescribedDose(), r.route(),
                        r.instructions(), r.startAt(), r.endAt(), r.schedule()),
                new TreatmentService.Change(r.baseVersion(), r.effectiveFrom(), r.reason()),
                offline(r.preserveConflict(), r.deviceId(), operationKey, r));
        return respond(outcome);
    }

    @POST
    @Path("/{treatmentId}/status")
    public Response changeStatus(@PathParam("familyId") UUID familyId,
            @PathParam("treatmentId") UUID treatmentId, @HeaderParam(ClientOperations.HEADER) String operationKey,
            @Valid @NotNull ChangeStatus r) {
        Instant effectiveFrom = r.effectiveFrom() == null ? Instant.now() : r.effectiveFrom();
        TreatmentService.PastDoses past = r.pastDoses() == null ? TreatmentService.PastDoses.OPEN : r.pastDoses();
        TreatmentService.Outcome outcome = treatments.changeStatus(familyId, treatmentId, r.status(),
                new TreatmentService.Change(r.baseVersion(), effectiveFrom, r.reason()), past, r.deviceId(),
                offline(r.preserveConflict(), r.deviceId(), operationKey, r));
        return respond(outcome);
    }

    /** Alterações feitas sem conexão aguardando conferência (seção 10.2). */
    @GET
    @Path("/conflicts")
    public List<ConflictView> conflicts(@PathParam("familyId") UUID familyId) {
        return treatments.conflicts(familyId).stream().map(c -> {
            Treatment t = Treatment.findById(c.entityId);
            List<ProposalView> proposals = SyncConflictChange.forConflict(c.id).stream().map(ch -> {
                SyncOperation op = SyncOperation.findById(ch.operationId);
                return new ProposalView(ch.id, (String) ch.proposedData.get("action"), op.actorId, op.deviceId,
                        ch.baseVersion, ch.proposedData, ch.createdAt);
            }).toList();
            return new ConflictView(c.id, c.reason, c.baseVersion, c.createdAt, TreatmentView.of(t, c.id), proposals);
        }).toList();
    }

    @POST
    @Path("/{treatmentId}/conflict/resolution")
    public TreatmentView resolve(@PathParam("familyId") UUID familyId, @PathParam("treatmentId") UUID treatmentId,
            @Valid @NotNull Resolve r) {
        if (r.choice() == TreatmentService.Choice.ADOPT && r.proposalId() == null) {
            throw ApiException.unprocessable("PROPOSAL_REQUIRED", "Escolha a proposta a aplicar.");
        }
        return TreatmentView.of(treatments.resolve(familyId, treatmentId,
                new TreatmentService.Resolution(r.conflictId(), r.choice(), r.proposalId(), r.baseVersion(),
                        r.reason())));
    }

    @GET
    @Path("/{treatmentId}/revisions")
    public List<RevisionView> revisions(@PathParam("familyId") UUID familyId,
            @PathParam("treatmentId") UUID treatmentId) {
        return treatments.revisions(familyId, treatmentId).stream().map(RevisionView::of).toList();
    }

    private TreatmentService.Offline offline(Boolean preserve, UUID deviceId, String operationKey, Object request) {
        if (!Boolean.TRUE.equals(preserve)) {
            return null;
        }
        if (deviceId == null || operationKey == null) {
            throw ApiException.unprocessable("OFFLINE_OPERATION_INCOMPLETE",
                    "Alterações da fila offline precisam do aparelho e da chave da operação.");
        }
        UUID key;
        try {
            key = UUID.fromString(operationKey.trim());
        } catch (IllegalArgumentException e) {
            throw ApiException.unprocessable("INVALID_IDEMPOTENCY_KEY", "A chave da operação deve ser um UUID.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> data = json.convertValue(request, Map.class);
        return new TreatmentService.Offline(deviceId, key, data);
    }

    private static Response respond(TreatmentService.Outcome outcome) {
        if (outcome.conflictId() != null) {
            return Response.accepted(new InReview("IN_REVIEW", outcome.conflictId(),
                    TreatmentView.of(outcome.treatment(), outcome.conflictId()))).build();
        }
        return Response.ok(TreatmentView.of(outcome.treatment())).build();
    }
}
