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

    public record Administer(@NotNull UUID deviceId, Instant administeredAt, @Size(max = 1000) String notes) {
    }

    public record NotAdministered(@Size(max = 1000) String reason) {
    }

    public record Correct(
            @NotNull Long baseVersion,
            @NotNull OccurrenceService.CorrectionTarget status,
            Instant administeredAt,
            @Size(max = 1000) String notes,
            @NotBlank @Size(max = 1000) String reason,
            UUID deviceId) {
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
                r.notes()))).getFirst();
    }

    @POST
    @Path("/occurrences/{occurrenceId}/not-administered")
    public OccurrenceView notAdministered(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId, @Valid NotAdministered r) {
        return views.of(List.of(occurrences.markNotAdministered(familyId, occurrenceId,
                r == null ? null : r.reason()))).getFirst();
    }

    @POST
    @Path("/occurrences/{occurrenceId}/correction")
    public OccurrenceView correct(@PathParam("familyId") UUID familyId,
            @PathParam("occurrenceId") UUID occurrenceId, @Valid @NotNull Correct r) {
        return views.of(List.of(occurrences.correct(familyId, occurrenceId, new OccurrenceService.Correction(
                r.baseVersion(), r.status(), r.administeredAt(), r.notes(), r.reason(), r.deviceId()))))
                .getFirst();
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
