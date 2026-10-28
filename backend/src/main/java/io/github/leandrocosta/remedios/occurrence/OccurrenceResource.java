package io.github.leandrocosta.remedios.occurrence;

import io.github.leandrocosta.remedios.occurrence.OccurrenceViews.OccurrenceDetail;
import io.github.leandrocosta.remedios.occurrence.OccurrenceViews.OccurrenceView;
import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.QueryParam;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Path("/api/families/{familyId}")
@Authenticated
public class OccurrenceResource {

    /**
     * {@code operationId}, {@code baseVersion} e {@code recordedAt} são
     * enviados pelo app (inclusive pela fila offline): tornam o envio
     * idempotente e permitem preservar registros divergentes.
     */
    public record Administer(@NotNull UUID deviceId, Instant administeredAt, @Size(max = 1000) String notes,
            UUID operationId, Long baseVersion, Instant recordedAt) {
    }

    public record NotAdministered(@Size(max = 1000) String reason, UUID deviceId, UUID operationId,
            Long baseVersion, Instant recordedAt) {
    }

    public record Resolve(
            @NotNull Long baseVersion,
            @NotNull OccurrenceService.Decision status,
            UUID proposalId,
            Instant administeredAt,
            UUID deviceId,
            @NotBlank @Size(max = 1000) String reason) {
    }

    public record Correct(
            @NotNull Long baseVersion,
            @NotNull OccurrenceService.CorrectionTarget status,
            Instant administeredAt,
            @Size(max = 1000) String notes,
            @NotBlank @Size(max = 1000) String reason,
            UUID deviceId) {
    }

    /** "Lembrar daqui a pouco": quando lembrar de novo (calculado no aparelho, que pode estar offline). */
    public record Snooze(@NotNull Instant remindAt) {
    }

    private final OccurrenceService occurrences;
    private final OccurrenceViews views;

    public OccurrenceResource(OccurrenceService occurrences, OccurrenceViews views) {
        this.occurrences = occurrences;
        this.views = views;
    }

    /** Doses previstas no período (tela Hoje: o dia local do aparelho). */
    @GET
    @Path("/occurrences")
    public List<OccurrenceView> agenda(@PathParam("familyId") UUID familyId, @QueryParam("from") Instant from,
            @QueryParam("to") Instant to, @QueryParam("personId") UUID personId,
            @QueryParam("treatmentId") UUID treatmentId) {
        return views.of(occurrences.agenda(familyId, from, to, personId, treatmentId));
    }

    @GET
    @Path("/occurrences/{occurrenceId}")
    public OccurrenceDetail detail(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId) {
        return views.detail(occurrences.get(familyId, occurrenceId));
    }

    @POST
    @Path("/occurrences/{occurrenceId}/administration")
    public OccurrenceView administer(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId, @Valid @NotNull Administer r) {
        return views.of(List.of(occurrences.administer(familyId, occurrenceId, r.deviceId(), r.administeredAt(),
                r.notes(), new OccurrenceService.Operation(r.operationId(), r.baseVersion(), r.recordedAt()))))
                .getFirst();
    }

    @POST
    @Path("/occurrences/{occurrenceId}/not-administered")
    public OccurrenceView notAdministered(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId, @Valid NotAdministered r) {
        NotAdministered n = r == null ? new NotAdministered(null, null, null, null, null) : r;
        return views.of(List.of(occurrences.markNotAdministered(familyId, occurrenceId, n.reason(), n.deviceId(),
                new OccurrenceService.Operation(n.operationId(), n.baseVersion(), n.recordedAt())))).getFirst();
    }

    @POST
    @Path("/occurrences/{occurrenceId}/correction")
    public OccurrenceView correct(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId, @Valid @NotNull Correct r) {
        return views.of(List.of(occurrences.correct(familyId, occurrenceId, new OccurrenceService.Correction(
                r.baseVersion(), r.status(), r.administeredAt(), r.notes(), r.reason(), r.deviceId()))))
                .getFirst();
    }

    /** "Estou cuidando desta dose": reduz os lembretes dos outros por alguns minutos. */
    @POST
    @Path("/occurrences/{occurrenceId}/claim")
    public OccurrenceView claim(@PathParam("familyId") UUID familyId, @PathParam("occurrenceId") UUID occurrenceId) {
        return views.of(List.of(occurrences.claim(familyId, occurrenceId))).getFirst();
    }

    @jakarta.ws.rs.DELETE
    @Path("/occurrences/{occurrenceId}/claim")
    public OccurrenceView releaseClaim(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId) {
        return views.of(List.of(occurrences.releaseClaim(familyId, occurrenceId))).getFirst();
    }

    /** Adia só o lembrete desta dose para quem pediu; o horário da dose não muda. */
    @jakarta.ws.rs.PUT
    @Path("/occurrences/{occurrenceId}/snooze")
    public OccurrenceView snooze(@PathParam("familyId") UUID familyId, @PathParam("occurrenceId") UUID occurrenceId,
            @Valid @NotNull Snooze s) {
        return views.of(List.of(occurrences.snooze(familyId, occurrenceId, s.remindAt()))).getFirst();
    }

    @jakarta.ws.rs.DELETE
    @Path("/occurrences/{occurrenceId}/snooze")
    public OccurrenceView cancelSnooze(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId) {
        return views.of(List.of(occurrences.cancelSnooze(familyId, occurrenceId))).getFirst();
    }

    /** Decisão humana sobre uma dose com registros divergentes (seção 10.3). */
    @POST
    @Path("/occurrences/{occurrenceId}/resolution")
    public OccurrenceView resolve(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId, @Valid @NotNull Resolve r) {
        return views.of(List.of(occurrences.resolve(familyId, occurrenceId, new OccurrenceService.Resolution(
                r.baseVersion(), r.status(), r.proposalId(), r.administeredAt(), r.deviceId(), r.reason()))))
                .getFirst();
    }

    /** Doses aguardando revisão, com as propostas preservadas. */
    @GET
    @Path("/conflicts")
    public List<OccurrenceDetail> conflicts(@PathParam("familyId") UUID familyId) {
        return occurrences.openConflicts(familyId).stream().map(views::detail).toList();
    }

    @GET
    @Path("/history")
    public List<OccurrenceView> history(@PathParam("familyId") UUID familyId, @QueryParam("from") Instant from,
            @QueryParam("to") Instant to, @QueryParam("personId") UUID personId,
            @QueryParam("treatmentId") UUID treatmentId, @QueryParam("recordedBy") UUID recordedBy,
            @QueryParam("limit") @DefaultValue("200") int limit) {
        return views.of(occurrences.history(familyId, from, to, personId, treatmentId, recordedBy, limit));
    }
}
