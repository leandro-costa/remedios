package io.github.leandrocosta.remedios;

import static org.junit.jupiter.api.Assertions.assertThrows;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.hibernate.orm.panache.Panache;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.persistence.PersistenceException;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Garantias de integridade que o banco aplica por conta própria, mesmo que um
 * bug na aplicação tente contorná-las (seções 3.3, 5.3 e 9.2).
 */
@QuarkusTest
class SchemaConstraintsTest {

    @Test
    void personCannotLinkToAccountOutsideTheFamily() {
        User ana = Api.newUser("Ana");
        User eve = Api.newUser("Eve");
        UUID family = Api.createFamily(ana, "Família");
        UUID eveId = eve.id();

        assertThrows(PersistenceException.class, () -> sql(
                "INSERT INTO person (id, family_id, user_id, display_name) VALUES ('%s', '%s', '%s', 'Eve')",
                UUID.randomUUID(), family, eveId));
    }

    @Test
    void treatmentPersonMustBelongToTheSameFamily() {
        User ana = Api.newUser("Ana");
        UUID familyA = Api.createFamily(ana, "A");
        UUID familyB = Api.createFamily(ana, "B");
        UUID person = UUID.randomUUID();
        sql("INSERT INTO person (id, family_id, display_name) VALUES ('%s', '%s', 'Gabriel')", person, familyA);

        assertThrows(PersistenceException.class, () -> sql("""
                INSERT INTO treatment (id, family_id, person_id, name, kind, prescribed_dose, status, start_at,
                                       version, created_by, updated_by, prescription_id)
                VALUES ('%s', '%s', '%s', 'X', 'CONTINUOUS', '1', 'DRAFT', now(), 1, '%s', '%s', '%s')
                """, UUID.randomUUID(), familyB, person, ana.id(), ana.id(), prescription(familyA, person, ana.id())));
    }

    @Test
    void atMostOneAdministrationPerOccurrenceAndNoDuplicateSlots() {
        User ana = Api.newUser("Ana");
        UUID user = ana.id();
        UUID family = Api.createFamily(ana, "Família");
        UUID person = UUID.randomUUID();
        UUID treatment = UUID.randomUUID();
        UUID schedule = UUID.randomUUID();
        UUID occurrence = UUID.randomUUID();
        UUID device = UUID.randomUUID();
        sql("INSERT INTO person (id, family_id, display_name) VALUES ('%s', '%s', 'Gabriel')", person, family);
        sql("""
                INSERT INTO treatment (id, family_id, person_id, name, kind, prescribed_dose, status, start_at,
                                       version, created_by, updated_by, prescription_id)
                VALUES ('%s', '%s', '%s', 'X', 'CONTINUOUS', '1', 'ACTIVE', now(), 1, '%s', '%s', '%s')
                """, treatment, family, person, user, user, prescription(family, person, user));
        sql("""
                INSERT INTO treatment_schedule (id, treatment_id, rule, timezone, reminder_before_minutes,
                    repeat_interval_minutes, repeat_limit, late_tolerance_minutes, version, valid_from)
                VALUES ('%s', '%s', '{"type":"DAILY"}', 'America/Bahia', 10, 15, 4, 30, 1, now())
                """, schedule, treatment);
        String occurrenceSql = """
                INSERT INTO dose_occurrence (id, family_id, treatment_id, schedule_id, slot_key, scheduled_at,
                                             schedule_version, status)
                VALUES ('%s', '%s', '%s', '%s', '%s', '2026-10-22T11:00:00Z', 1, 'PENDING')
                """;
        sql(occurrenceSql, occurrence, family, treatment, schedule, "2026-10-22T08:00#1");
        // Duas doses legítimas no mesmo horário: permitido com chaves distintas.
        sql(occurrenceSql, UUID.randomUUID(), family, treatment, schedule, "2026-10-22T08:00#2");
        assertThrows(PersistenceException.class,
                () -> sql(occurrenceSql, UUID.randomUUID(), family, treatment, schedule, "2026-10-22T08:00#1"));

        sql("INSERT INTO device (id, user_id, platform) VALUES ('%s', '%s', 'ANDROID')", device, user);
        String administrationSql = """
                INSERT INTO administration_record (id, dose_occurrence_id, recorded_by, device_id,
                                                   administered_at, recorded_at)
                VALUES ('%s', '%s', '%s', '%s', now(), now())
                """;
        UUID first = UUID.randomUUID();
        sql(administrationSql, first, occurrence, user, device);
        assertThrows(PersistenceException.class,
                () -> sql(administrationSql, UUID.randomUUID(), occurrence, user, device));

        // Invalidado por correção, o registro continua guardado e libera um novo registro válido.
        sql("UPDATE administration_record SET voided_at = now(), voided_by = '%s', void_reason = 'erro' WHERE id = '%s'",
                user, first);
        sql(administrationSql, UUID.randomUUID(), occurrence, user, device);
    }

    @Test
    void onlyOneCurrentScheduleVersionPerTreatment() {
        User ana = Api.newUser("Ana");
        UUID user = ana.id();
        UUID family = Api.createFamily(ana, "Família");
        UUID person = UUID.randomUUID();
        UUID treatment = UUID.randomUUID();
        sql("INSERT INTO person (id, family_id, display_name) VALUES ('%s', '%s', 'Gabriel')", person, family);
        sql("""
                INSERT INTO treatment (id, family_id, person_id, name, kind, prescribed_dose, status, start_at,
                                       version, created_by, updated_by, prescription_id)
                VALUES ('%s', '%s', '%s', 'X', 'CONTINUOUS', '1', 'ACTIVE', now(), 1, '%s', '%s', '%s')
                """, treatment, family, person, user, user, prescription(family, person, user));
        String scheduleSql = """
                INSERT INTO treatment_schedule (id, treatment_id, rule, timezone, reminder_before_minutes,
                    repeat_interval_minutes, repeat_limit, late_tolerance_minutes, version, valid_from)
                VALUES ('%s', '%s', '{"type":"DAILY"}', 'UTC', 10, 15, 4, 30, %d, now())
                """;
        sql(scheduleSql, UUID.randomUUID(), treatment, 1);
        assertThrows(PersistenceException.class, () -> sql(scheduleSql, UUID.randomUUID(), treatment, 2));
    }

    private static void sql(String template, Object... args) {
        QuarkusTransaction.requiringNew().run(() -> Panache.getEntityManager()
                .createNativeQuery(template.formatted(args))
                .executeUpdate());
    }

    /** Receita para os itens inseridos direto no banco. */
    private UUID prescription(UUID family, UUID person, UUID user) {
        UUID id = UUID.randomUUID();
        sql("""
                INSERT INTO prescription (id, family_id, person_id, created_by, created_at, updated_at)
                VALUES ('%s', '%s', '%s', '%s', now(), now())
                """, id, family, person, user);
        return id;
    }
}
