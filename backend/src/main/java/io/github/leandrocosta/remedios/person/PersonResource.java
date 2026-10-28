package io.github.leandrocosta.remedios.person;

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
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Path("/api/families/{familyId}/persons")
@Authenticated
public class PersonResource {

    public record PersonView(UUID id, String displayName, LocalDate birthDate, UUID userId, boolean active) {
        static PersonView of(Person p) {
            return new PersonView(p.id, p.displayName, p.birthDate, p.userId, p.active);
        }
    }

    public record PersonRequest(
            @NotBlank @Size(max = 120) String displayName,
            LocalDate birthDate,
            UUID userId,
            Boolean active) {

        PersonService.PersonData toData() {
            return new PersonService.PersonData(displayName, birthDate, userId, active == null || active);
        }
    }

    private final PersonService persons;

    public PersonResource(PersonService persons) {
        this.persons = persons;
    }

    @GET
    public List<PersonView> list(@PathParam("familyId") UUID familyId, @QueryParam("active") Boolean active) {
        return persons.list(familyId, active).stream().map(PersonView::of).toList();
    }

    @POST
    public Response create(@PathParam("familyId") UUID familyId, @Valid @NotNull PersonRequest request) {
        Person person = persons.create(familyId, request.toData());
        return Response.status(Response.Status.CREATED).entity(PersonView.of(person)).build();
    }

    @GET
    @Path("/{personId}")
    public PersonView get(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId) {
        return PersonView.of(persons.get(familyId, personId));
    }

    @PUT
    @Path("/{personId}")
    public PersonView update(@PathParam("familyId") UUID familyId, @PathParam("personId") UUID personId,
            @Valid @NotNull PersonRequest request) {
        return PersonView.of(persons.update(familyId, personId, request.toData()));
    }
}
