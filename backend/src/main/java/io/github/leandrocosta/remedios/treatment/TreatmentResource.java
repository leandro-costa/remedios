package io.github.leandrocosta.remedios.treatment;

import io.github.leandrocosta.remedios.schedule.ScheduleRule;
import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.GET;
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

    public record TreatmentView(UUID id, UUID personId, String name, Treatment.Kind kind, String prescribedDose,
            String route, String instructions, Treatment.Status status, Instant startAt, Instant endAt,
            Map<String, Object> schedule, long version, UUID createdBy, Instant createdAt, UUID updatedBy,
            Instant updatedAt) {

        static TreatmentView of(Treatment t) {
            return new TreatmentView(t.id, t.personId, t.name, t.kind, t.prescribedDose, t.route, t.instructions,
                    t.status, t.startAt, t.endAt, t.scheduleRule, t.version, t.createdBy, t.createdAt, t.updatedBy,
                    t.updatedAt);
        }
    }

    public record RevisionView(long version, Long baseVersion, Map<String, Object> snapshot, Instant effectiveFrom,
            String changeReason, UUID createdBy, Instant createdAt) {

        static RevisionView of(TreatmentRevision r) {
            return new RevisionView(r.version, r.baseVersion, r.snapshot, r.effectiveFrom, r.changeReason,
                    r.createdBy, r.createdAt);
        }
    }

    public record CreateTreatment(
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
            @Size(max = 1000) String reason) {
    }

    public record ChangeStatus(
            @NotNull Treatment.Status status,
            @NotNull Long baseVersion,
            Instant effectiveFrom,
            @Size(max = 1000) String reason) {
    }

    private final TreatmentService treatments;

    public TreatmentResource(TreatmentService treatments) {
        this.treatments = treatments;
    }

    @GET
    public List<TreatmentView> list(@PathParam("familyId") UUID familyId, @QueryParam("personId") UUID personId,
            @QueryParam("status") Treatment.Status status) {
        return treatments.list(familyId, personId, status).stream().map(TreatmentView::of).toList();
    }

    @POST
    public Response create(@PathParam("familyId") UUID familyId, @Valid @NotNull CreateTreatment request) {
        Treatment t = treatments.create(familyId, request.personId(), request.toData());
        return Response.status(Response.Status.CREATED).entity(TreatmentView.of(t)).build();
    }

    @GET
    @Path("/{treatmentId}")
    public TreatmentView get(@PathParam("familyId") UUID familyId, @PathParam("treatmentId") UUID treatmentId) {
        return TreatmentView.of(treatments.get(familyId, treatmentId));
    }

    @PUT
    @Path("/{treatmentId}")
    public TreatmentView update(@PathParam("familyId") UUID familyId, @PathParam("treatmentId") UUID treatmentId,
            @Valid @NotNull UpdateTreatment r) {
        Treatment t = treatments.update(familyId, treatmentId,
                new TreatmentService.TreatmentData(r.name(), r.kind(), r.prescribedDose(), r.route(),
                        r.instructions(), r.startAt(), r.endAt(), r.schedule()),
                new TreatmentService.Change(r.baseVersion(), r.effectiveFrom(), r.reason()));
        return TreatmentView.of(t);
    }

    @POST
    @Path("/{treatmentId}/status")
    public TreatmentView changeStatus(@PathParam("familyId") UUID familyId,
            @PathParam("treatmentId") UUID treatmentId, @Valid @NotNull ChangeStatus r) {
        Instant effectiveFrom = r.effectiveFrom() == null ? Instant.now() : r.effectiveFrom();
        Treatment t = treatments.changeStatus(familyId, treatmentId, r.status(),
                new TreatmentService.Change(r.baseVersion(), effectiveFrom, r.reason()));
        return TreatmentView.of(t);
    }

    @GET
    @Path("/{treatmentId}/revisions")
    public List<RevisionView> revisions(@PathParam("familyId") UUID familyId,
            @PathParam("treatmentId") UUID treatmentId) {
        return treatments.revisions(familyId, treatmentId).stream().map(RevisionView::of).toList();
    }
}
