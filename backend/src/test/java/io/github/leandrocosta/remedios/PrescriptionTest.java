package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.leandrocosta.remedios.treatment.TreatmentEndJob;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Receita com vários itens: situação calculada, ações em todos os itens e fim junto com os itens com horário. */
@QuarkusTest
class PrescriptionTest {

    @Inject
    TreatmentEndJob endJob;

    Dosing d;
    String prescription;

    @BeforeEach
    void setUp() {
        d = new Dosing();
        prescription = UUID.randomUUID().toString();
        d.ana.req().body(Map.of("id", prescription, "personId", d.person, "title", "Infecção de garganta",
                "prescriber", "Dra. Lima", "prescribedOn", "2026-10-28"))
                .post("/api/families/{f}/prescriptions", d.family).then().statusCode(201)
                .body("status", equalTo("DRAFT")).body("items", hasSize(0));
    }

    private String item(String name, String kind, Map<String, Object> extra) {
        Map<String, Object> body = new HashMap<>();
        body.put("prescriptionId", prescription);
        body.put("personId", d.person);
        body.put("name", name);
        body.put("kind", kind);
        body.put("prescribedDose", "1");
        body.put("startAt", d.now.minus(3, ChronoUnit.DAYS).toString());
        if (!kind.equals("AS_NEEDED")) {
            body.put("schedule", Dosing.dailyAt(d.now.minus(2, ChronoUnit.HOURS)));
        }
        body.putAll(extra);
        String id = d.ana.req().body(body).post("/api/families/{f}/treatments", d.family)
                .then().statusCode(201).body("prescriptionId", equalTo(prescription)).extract().path("id");
        d.activate(id, 1, d.now.minus(3, ChronoUnit.DAYS));
        return id;
    }

    private String status(String treatment) {
        return d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, treatment).then().extract().path("status");
    }

    @Test
    void statusComesFromItemsAndActionsApplyToAll() {
        String antibiotic = item("Amoxicilina", "OCCASIONAL", Map.of());
        String painkiller = item("Dipirona", "AS_NEEDED", Map.of());
        d.ana.req().get("/api/families/{f}/prescriptions/{p}", d.family, prescription).then()
                .body("status", equalTo("ACTIVE")).body("items", hasSize(2)).body("title", equalTo("Infecção de garganta"));

        d.ana.req().body(Map.of("status", "SUSPENDED")).post("/api/families/{f}/prescriptions/{p}/status", d.family, prescription)
                .then().statusCode(200).body("status", equalTo("SUSPENDED"));
        assertEquals("SUSPENDED", status(antibiotic));
        assertEquals("SUSPENDED", status(painkiller));
        d.ana.req().body(Map.of("status", "ACTIVE")).post("/api/families/{f}/prescriptions/{p}/status", d.family, prescription)
                .then().statusCode(200).body("status", equalTo("ACTIVE"));
        d.ana.req().body(Map.of("status", "ENDED", "reason", "Alta")).post("/api/families/{f}/prescriptions/{p}/status", d.family, prescription)
                .then().statusCode(200).body("status", equalTo("ENDED"));
        assertEquals("ENDED", status(painkiller));
    }

    @Test
    void endingTheLastScheduledItemEndsTheAsNeededOnes() {
        String antibiotic = item("Amoxicilina", "OCCASIONAL", Map.of());
        String painkiller = item("Dipirona", "AS_NEEDED", Map.of());
        d.ana.req().body(Map.of("status", "ENDED", "baseVersion", 2, "effectiveFrom", Instant.now().toString()))
                .post("/api/families/{f}/treatments/{t}/status", d.family, antibiotic).then().statusCode(200);
        assertEquals("ENDED", status(painkiller), "o item em caso de dor acompanha a receita");
        d.ana.req().get("/api/families/{f}/prescriptions/{p}", d.family, prescription).then().body("status", equalTo("ENDED"));
    }

    @Test
    void finishedCourseEndsByItselfAndTakesTheAsNeededItems() {
        // 3 doses diárias; a dipirona fica sem uso.
        String antibiotic = item("Amoxicilina", "OCCASIONAL", Map.of("doseCount", 3));
        String painkiller = item("Dipirona", "AS_NEEDED", Map.of());
        String other = item("Vitamina", "CONTINUOUS", Map.of("prescriptionId", prescription));
        // Um dia depois, a última dose (há 2 h) já passou do prazo para registrar.
        assertEquals(1, endJob.run(Instant.now().plus(1, ChronoUnit.DAYS)), "só o antibiótico terminou");
        assertEquals("ENDED", status(antibiotic));
        assertEquals("ACTIVE", status(painkiller), "ainda há item com horário (vitamina)");
        d.ana.req().body(Map.of("status", "ENDED", "baseVersion", 2, "effectiveFrom", Instant.now().toString()))
                .post("/api/families/{f}/treatments/{t}/status", d.family, other).then().statusCode(200);
        assertEquals("ENDED", status(painkiller));
    }

    @Test
    void itemsMustBelongToTheSamePersonAndOldClientsGetAPrescription() {
        String other = d.ana.req().body(PersonTest.person("Lia", null, null)).post("/api/families/{f}/persons", d.family)
                .then().statusCode(201).extract().path("id");
        Map<String, Object> body = new HashMap<>();
        body.put("prescriptionId", prescription);
        body.put("personId", other);
        body.put("name", "X");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", "1");
        body.put("startAt", d.now.toString());
        d.ana.req().body(body).post("/api/families/{f}/treatments", d.family).then().statusCode(422)
                .body("code", equalTo("PRESCRIPTION_OTHER_PERSON"));
        body.remove("prescriptionId");
        String alone = d.ana.req().body(body).post("/api/families/{f}/treatments", d.family).then().statusCode(201)
                .extract().path("prescriptionId");
        d.ana.req().get("/api/families/{f}/prescriptions/{p}", d.family, alone).then().body("items", hasSize(1))
                .body("personId", equalTo(other));
    }

    @Test
    void deletingAPrescriptionHidesItAndItsItems() {
        String antibiotic = item("Amoxicilina", "OCCASIONAL", Map.of());
        d.bruno.req().body(Map.of("reason", "Engano")).post("/api/families/{f}/prescriptions/{p}/deletion", d.family, prescription)
                .then().statusCode(403);
        d.ana.req().body(Map.of("reason", "Engano")).post("/api/families/{f}/prescriptions/{p}/deletion", d.family, prescription)
                .then().statusCode(204);
        d.ana.req().get("/api/families/{f}/prescriptions/{p}", d.family, prescription).then().statusCode(404);
        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, antibiotic).then().statusCode(404);
        d.ana.req().get("/api/families/{f}/prescriptions", d.family).then().body("$", hasSize(0));
    }
}
