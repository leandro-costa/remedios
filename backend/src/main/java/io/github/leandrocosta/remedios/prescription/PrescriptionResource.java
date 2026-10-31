package io.github.leandrocosta.remedios.prescription;

import io.github.leandrocosta.remedios.treatment.Treatment;
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
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Path("/api/families/{familyId}/prescriptions")
@Authenticated
public class PrescriptionResource {

    public record ItemView(UUID id, String name, UUID medicationId, Treatment.Kind kind, Treatment.Status status,
            String prescribedDose) {
    }

    /** {@code status}: calculada a partir dos itens. */
    public record PrescriptionView(UUID id, UUID personId, String title, String prescriber, LocalDate prescribedOn,
            String notes, Treatment.Status status, List<ItemView> items, Instant createdAt, Instant updatedAt) {

        static PrescriptionView of(Prescription p) {
            List<Treatment> items = PrescriptionService.items(p.id);
            return new PrescriptionView(p.id, p.personId, p.title, p.prescriber, p.prescribedOn, p.notes,
                    PrescriptionService.status(items),
                    items.stream().map(t -> new ItemView(t.id, t.name, t.medicationId, t.kind, t.status,
                            t.prescribedDose)).toList(),
                    p.createdAt, p.updatedAt);
        }
    }

    public record PrescriptionRequest(
            /** Só no cadastro: id gerado no aparelho (opcional). */
            UUID id,
            UUID personId,
            @Size(max = 200) String title,
            @Size(max = 200) String prescriber,
            LocalDate prescribedOn,
            @Size(max = 2000) String notes) {

        PrescriptionService.PrescriptionData toData() {
            return new PrescriptionService.PrescriptionData(title, prescriber, prescribedOn, notes);
        }
    }

    public record ChangeStatus(@NotNull Treatment.Status status, @Size(max = 1000) String reason) {
    }

    public record Delete(@NotBlank @Size(max = 1000) String reason) {
    }

    private final PrescriptionService prescriptions;

    public PrescriptionResource(PrescriptionService prescriptions) {
        this.prescriptions = prescriptions;
    }

    @GET
    public List<PrescriptionView> list(@PathParam("familyId") UUID familyId, @QueryParam("personId") UUID personId) {
        return prescriptions.list(familyId, personId).stream().map(PrescriptionView::of).toList();
    }

    @POST
    public Response create(@PathParam("familyId") UUID familyId, @Valid @NotNull PrescriptionRequest r) {
        if (r.personId() == null) {
            throw io.github.leandrocosta.remedios.common.ApiException.unprocessable("PERSON_REQUIRED",
                    "Informe a pessoa da receita.");
        }
        Prescription p = prescriptions.create(familyId, r.id(), r.personId(), r.toData());
        return Response.status(Response.Status.CREATED).entity(PrescriptionView.of(p)).build();
    }

    @GET
    @Path("/{prescriptionId}")
    public PrescriptionView get(@PathParam("familyId") UUID familyId, @PathParam("prescriptionId") UUID id) {
        return PrescriptionView.of(prescriptions.get(familyId, id));
    }

    @PUT
    @Path("/{prescriptionId}")
    public PrescriptionView update(@PathParam("familyId") UUID familyId, @PathParam("prescriptionId") UUID id,
            @Valid @NotNull PrescriptionRequest r) {
        return PrescriptionView.of(prescriptions.update(familyId, id, r.toData()));
    }

    @POST
    @Path("/{prescriptionId}/status")
    public PrescriptionView changeStatus(@PathParam("familyId") UUID familyId, @PathParam("prescriptionId") UUID id,
            @Valid @NotNull ChangeStatus r) {
        return PrescriptionView.of(prescriptions.changeStatus(familyId, id, r.status(), r.reason()));
    }

    @POST
    @Path("/{prescriptionId}/deletion")
    public Response delete(@PathParam("familyId") UUID familyId, @PathParam("prescriptionId") UUID id,
            @Valid @NotNull Delete r) {
        prescriptions.delete(familyId, id, r.reason());
        return Response.noContent().build();
    }
}
