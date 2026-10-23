package io.github.leandrocosta.remedios.push;

import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Lembretes avulsos por pessoa (ex.: "medir a temperatura de novo às 15:00"). */
@Path("/api/families/{familyId}")
@Authenticated
public class CustomReminderResource {

    public record CreateReminder(@NotBlank @Size(max = 300) String message, @NotNull Instant remindAt, Boolean notifyEveryone) {
    }

    public record ReminderView(UUID id, UUID personId, String message, Instant remindAt, boolean notifyEveryone, UUID createdBy) {
        static ReminderView of(CustomReminder r) {
            return new ReminderView(r.id, r.personId, r.message, r.remindAt, r.notifyAll, r.createdBy);
        }
    }

    private final CustomReminderService reminders;

    public CustomReminderResource(CustomReminderService reminders) {
        this.reminders = reminders;
    }

    @GET
    @Path("/persons/{personId}/reminders")
    public List<ReminderView> pending(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId) {
        return reminders.pending(familyId, personId).stream().map(ReminderView::of).toList();
    }

    @POST
    @Path("/persons/{personId}/reminders")
    public ReminderView create(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId,
            @Valid @NotNull CreateReminder r) {
        return ReminderView.of(reminders.create(familyId, personId, r.message(), r.remindAt(),
                Boolean.TRUE.equals(r.notifyEveryone())));
    }

    @DELETE
    @Path("/reminders/{reminderId}")
    public Response cancel(@PathParam("familyId") UUID familyId, @PathParam("reminderId") UUID id) {
        reminders.cancel(familyId, id);
        return Response.noContent().build();
    }
}
