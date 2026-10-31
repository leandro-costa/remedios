package io.github.leandrocosta.remedios.privacy;

import io.github.leandrocosta.remedios.audit.AuditEvent;
import io.github.leandrocosta.remedios.audit.AuditService;
import io.github.leandrocosta.remedios.family.Family;
import io.github.leandrocosta.remedios.family.FamilyAccess;
import io.github.leandrocosta.remedios.family.FamilyMember;
import io.github.leandrocosta.remedios.family.FamilySettings;
import io.github.leandrocosta.remedios.health.Measurement;
import io.github.leandrocosta.remedios.health.ReferenceLine;
import io.github.leandrocosta.remedios.health.SymptomRecord;
import io.github.leandrocosta.remedios.medication.Medication;
import io.github.leandrocosta.remedios.medication.MedicationResource;
import io.github.leandrocosta.remedios.occurrence.AdministrationRecord;
import io.github.leandrocosta.remedios.occurrence.DoseOccurrence;
import io.github.leandrocosta.remedios.person.Person;
import io.github.leandrocosta.remedios.push.CustomReminder;
import io.github.leandrocosta.remedios.treatment.Treatment;
import io.github.leandrocosta.remedios.treatment.TreatmentRevision;
import io.github.leandrocosta.remedios.user.AppUser;
import io.github.leandrocosta.remedios.user.CurrentUser;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Exportação de todos os dados de uma família (LGPD: acesso e portabilidade).
 * Só administradores; cada exportação fica na auditoria. O conteúdo é o que
 * os membros já veem no app, num único arquivo JSON.
 */
@Path("/api/families/{familyId}/export")
@Authenticated
public class FamilyExportResource {

    static final int FORMAT_VERSION = 1;
    private static final DateTimeFormatter FILE_DATE = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);

    private final FamilyAccess access;
    private final CurrentUser currentUser;
    private final AuditService audit;

    public FamilyExportResource(FamilyAccess access, CurrentUser currentUser, AuditService audit) {
        this.access = access;
        this.currentUser = currentUser;
        this.audit = audit;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Transactional
    public Response export(@PathParam("familyId") UUID familyId) {
        access.requireAdmin(familyId);
        Instant now = Instant.now();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("formatVersion", FORMAT_VERSION);
        data.put("exportedAt", now);
        data.put("exportedBy", currentUser.id());
        data.put("family", fields(Family.findById(familyId)));
        data.put("settings", fields(FamilySettings.findById(familyId)));
        List<FamilyMember> members = FamilyMember.list("familyId", familyId);
        data.put("members", members.stream().map(m -> {
            Map<String, Object> row = fields(m);
            AppUser user = AppUser.findById(m.userId);
            row.put("displayName", user == null ? null : user.displayName);
            return row;
        }).toList());
        data.put("persons", rows(Person.list("familyId", familyId)));
        data.put("medications", Medication.<Medication>list("familyId", familyId).stream()
                .map(MedicationResource.MedicationView::of).toList());
        data.put("treatments", rows(Treatment.list("familyId", familyId)));
        data.put("treatmentRevisions", rows(TreatmentRevision.list(
                "treatmentId in (select t.id from Treatment t where t.familyId = ?1) order by treatmentId, version",
                familyId)));
        // Doses até agora: o futuro em aberto é só a agenda, já descrita nos tratamentos.
        data.put("doses", rows(DoseOccurrence.list("familyId = ?1 and scheduledAt <= ?2 order by scheduledAt",
                familyId, now)));
        data.put("administrations", rows(AdministrationRecord.list(
                "doseOccurrenceId in (select o.id from DoseOccurrence o where o.familyId = ?1) order by administeredAt",
                familyId)));
        data.put("measurements", rows(Measurement.list("familyId = ?1 order by measuredAt", familyId)));
        data.put("symptoms", rows(SymptomRecord.list("familyId = ?1 order by startedAt", familyId)));
        data.put("referenceLines", rows(ReferenceLine.list("familyId", familyId)));
        data.put("reminders", rows(CustomReminder.list("familyId = ?1 order by remindAt", familyId)));
        data.put("auditTrail", rows(AuditEvent.list("familyId = ?1 order by occurredAt", familyId)));

        audit.record(familyId, currentUser.id(), "FAMILY", familyId, "FAMILY_EXPORTED", null, null, null);
        String file = "remedios-familia-" + FILE_DATE.format(now) + ".json";
        return Response.ok(data).header("Content-Disposition", "attachment; filename=\"" + file + "\"")
                .header("Cache-Control", "no-store").build();
    }

    private static List<Map<String, Object>> rows(List<?> entities) {
        return entities.stream().map(FamilyExportResource::fields).toList();
    }

    /** Colunas da entidade (campos declarados na classe), sem detalhes do Hibernate. */
    static Map<String, Object> fields(Object entity) {
        Map<String, Object> row = new LinkedHashMap<>();
        if (entity == null) {
            return row;
        }
        for (Field f : entity.getClass().getDeclaredFields()) {
            int mod = f.getModifiers();
            if (Modifier.isStatic(mod) || Modifier.isTransient(mod) || f.getName().startsWith("$")) {
                continue;
            }
            try {
                f.setAccessible(true);
                row.put(f.getName(), f.get(entity));
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
        return row;
    }
}
