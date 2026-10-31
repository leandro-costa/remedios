package io.github.leandrocosta.remedios.medication;

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
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Path("/api/families/{familyId}/medications")
@Authenticated
public class MedicationResource {

    public record SubstanceView(String substance, String concentration) {
    }

    public record MedicationView(UUID id, String name, String form, String manufacturer, String category, String notes,
            List<SubstanceView> substances, Instant createdAt, Instant updatedAt) {

        public static MedicationView of(Medication m) {
            return new MedicationView(m.id, m.name, m.form, m.manufacturer, m.category, m.notes,
                    m.substances.stream().map(s -> new SubstanceView(s.substance, s.concentration)).toList(),
                    m.createdAt, m.updatedAt);
        }
    }

    public record SubstanceRequest(@Size(max = 200) String substance, @Size(max = 100) String concentration) {
    }

    public record MedicationRequest(
            /** Só no cadastro: id gerado no aparelho (opcional). */
            UUID id,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 100) String form,
            @Size(max = 200) String manufacturer,
            @Size(max = 100) String category,
            @Size(max = 2000) String notes,
            @Size(max = MedicationService.MAX_SUBSTANCES) List<@Valid SubstanceRequest> substances) {

        MedicationService.MedicationData toData() {
            return new MedicationService.MedicationData(name, form, manufacturer, category, notes,
                    substances == null ? List.of() : substances.stream()
                            .map(s -> new MedicationService.SubstanceData(s.substance(), s.concentration())).toList());
        }
    }

    private final MedicationService medications;

    public MedicationResource(MedicationService medications) {
        this.medications = medications;
    }

    @GET
    public List<MedicationView> list(@PathParam("familyId") UUID familyId) {
        return medications.list(familyId).stream().map(MedicationView::of).toList();
    }

    @POST
    public Response create(@PathParam("familyId") UUID familyId, @Valid @NotNull MedicationRequest r) {
        Medication m = medications.create(familyId, r.id(), r.toData());
        return Response.status(Response.Status.CREATED).entity(MedicationView.of(m)).build();
    }

    @GET
    @Path("/{medicationId}")
    public MedicationView get(@PathParam("familyId") UUID familyId, @PathParam("medicationId") UUID id) {
        return MedicationView.of(medications.get(familyId, id));
    }

    @PUT
    @Path("/{medicationId}")
    public MedicationView update(@PathParam("familyId") UUID familyId, @PathParam("medicationId") UUID id,
            @Valid @NotNull MedicationRequest r) {
        return MedicationView.of(medications.update(familyId, id, r.toData()));
    }
}
