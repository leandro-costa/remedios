package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Exportação dos dados da família (LGPD: acesso e portabilidade). */
@QuarkusTest
class ExportTest {

    @Test
    void administradorExportaTudoEAExportacaoFicaNaAuditoria() {
        Dosing d = new Dosing();
        Instant pastAt = d.now.minus(1, ChronoUnit.HOURS);
        String t = d.createTreatment(Dosing.dailyAt(pastAt));
        d.activate(t, 1, d.now.minus(2, ChronoUnit.HOURS));
        String dose = d.occurrenceAt(pastAt);
        d.bruno.req().body(Map.of("deviceId", d.brunoDevice))
                .post("/api/families/{f}/occurrences/{o}/administration", d.family, dose).then().statusCode(200);
        d.ana.req().body(Map.of("id", UUID.randomUUID(), "deviceId", d.anaDevice, "type", "TEMPERATURE",
                "value", "38.1", "measuredAt", d.now.minus(5, ChronoUnit.MINUTES).toString()))
                .post("/api/families/{f}/persons/{p}/measurements", d.family, d.person).then().statusCode(200);

        d.ana.req().get("/api/families/{f}/export", d.family).then().statusCode(200)
                .header("Content-Disposition", containsString("attachment; filename=\"remedios-familia-"))
                .header("Cache-Control", "no-store")
                .body("formatVersion", equalTo(1))
                .body("family.id", equalTo(d.family.toString()))
                .body("members.displayName", hasItem("Bruno"))
                .body("persons.displayName", hasItem("Gabriel"))
                .body("treatments[0].id", equalTo(t))
                .body("treatmentRevisions", hasSize(2))
                .body("doses.find { it.id == '" + dose + "' }.status", equalTo("ADMINISTERED"))
                .body("administrations[0].doseOccurrenceId", equalTo(dose))
                .body("measurements[0].unit", equalTo("°C"))
                .body("auditTrail.eventType", hasItem("DOSE_ADMINISTERED"))
                // Só colunas: nada interno do Hibernate/Panache.
                .body("persons[0].persistent", nullValue())
                .body("persons[0].createdAt", notNullValue());

        // A exportação aparece na próxima.
        d.ana.req().get("/api/families/{f}/export", d.family).then()
                .body("auditTrail.eventType", hasItem("FAMILY_EXPORTED"));
    }

    @Test
    void membroComumEQuemEhDeForaNaoExportam() {
        Dosing d = new Dosing();
        d.bruno.req().get("/api/families/{f}/export", d.family).then().statusCode(403);
        Api.newUser("Eve").req().get("/api/families/{f}/export", d.family).then().statusCode(404);
    }
}
