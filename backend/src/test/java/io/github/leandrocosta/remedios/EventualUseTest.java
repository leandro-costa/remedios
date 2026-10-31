package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

import io.quarkus.test.junit.QuarkusTest;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Uso eventual: uma receita por pessoa (id = id da pessoa), só com itens "se necessário". */
@QuarkusTest
class EventualUseTest {

    Dosing d;

    @BeforeEach
    void setUp() {
        d = new Dosing();
    }

    private io.restassured.response.ValidatableResponse item(String kind) {
        Map<String, Object> body = new HashMap<>();
        body.put("prescriptionId", d.person);
        body.put("personId", d.person);
        body.put("name", "Dipirona");
        body.put("kind", kind);
        body.put("prescribedDose", "20 gotas");
        body.put("startAt", d.now.toString());
        if (!kind.equals("AS_NEEDED")) {
            body.put("schedule", Dosing.dailyAt(d.now));
        }
        return d.ana.req().body(body).post("/api/families/{f}/treatments", d.family).then();
    }

    @Test
    void createdOnFirstUseWithThePersonIdAndOnlyAsNeededItems() {
        item("AS_NEEDED").statusCode(201).body("prescriptionId", equalTo(d.person));
        // Outro aparelho (offline) também cadastra no uso eventual: a mesma receita.
        item("AS_NEEDED").statusCode(201).body("prescriptionId", equalTo(d.person));
        d.ana.req().get("/api/families/{f}/prescriptions/{p}", d.family, d.person).then().statusCode(200)
                .body("kind", equalTo("EVENTUAL")).body("title", equalTo("Uso eventual")).body("items", hasSize(2));
        item("CONTINUOUS").statusCode(422).body("code", equalTo("EVENTUAL_ONLY_AS_NEEDED"));
    }

    @Test
    void regularPrescriptionCannotTakeThePersonId() {
        d.ana.req().body(Map.of("id", d.person, "personId", d.person))
                .post("/api/families/{f}/prescriptions", d.family).then().statusCode(422)
                .body("code", equalTo("RESERVED_ID"));
    }
}
