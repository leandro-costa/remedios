package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.leandrocosta.remedios.catalog.AnvisaCatalog;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Medicamentos da família, reaproveitados entre tratamentos, e o catálogo da ANVISA. */
@QuarkusTest
class MedicationTest {

    @Inject
    AnvisaCatalog catalog;

    Dosing d;

    @BeforeEach
    void setUp() {
        d = new Dosing();
    }

    private Map<String, Object> tylenol(String id) {
        Map<String, Object> body = new HashMap<>();
        if (id != null) {
            body.put("id", id);
        }
        body.put("name", "Tylenol");
        body.put("form", "Comprimido");
        body.put("manufacturer", "Kenvue");
        body.put("category", "Novo");
        body.put("substances", List.of(Map.of("substance", "paracetamol", "concentration", "750 mg")));
        return body;
    }

    private String treatment(Map<String, Object> extra) {
        Map<String, Object> body = new HashMap<>();
        body.put("personId", d.person);
        body.put("name", "Tylenol");
        body.put("kind", "CONTINUOUS");
        body.put("prescribedDose", "1 comprimido");
        body.put("startAt", d.now.toString());
        body.put("schedule", Dosing.dailyAt(d.now));
        body.putAll(extra);
        return d.ana.req().body(body).post("/api/families/{f}/treatments", d.family)
                .then().statusCode(201).extract().path("id");
    }

    @Test
    void createListAndReuseInTwoTreatments() {
        String id = UUID.randomUUID().toString();
        d.ana.req().body(tylenol(id)).post("/api/families/{f}/medications", d.family).then().statusCode(201)
                .body("id", equalTo(id))
                .body("substances[0].substance", equalTo("paracetamol"))
                .body("substances[0].concentration", equalTo("750 mg"));
        String t1 = treatment(Map.of("medicationId", id));
        String t2 = treatment(Map.of("medicationId", id, "name", "Tylenol (febre)"));
        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, t1).then().body("medicationId", equalTo(id));
        d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, t2).then().body("medicationId", equalTo(id));
        d.bruno.req().get("/api/families/{f}/medications", d.family).then().statusCode(200).body("$", hasSize(1));
    }

    @Test
    void treatmentWithoutMedicationReusesOrCreatesOneByName() {
        String t1 = treatment(Map.of("name", "Xarope X"));
        String t2 = treatment(Map.of("name", "  xarope x "));
        String m1 = d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, t1).then().extract().path("medicationId");
        String m2 = d.ana.req().get("/api/families/{f}/treatments/{t}", d.family, t2).then().extract().path("medicationId");
        assertEquals(m1, m2);
        d.ana.req().get("/api/families/{f}/medications/{m}", d.family, m1).then().body("name", equalTo("Xarope X"))
                .body("substances", hasSize(0));
    }

    @Test
    void updateSubstancesAndRefuseOtherFamilies() {
        String id = d.ana.req().body(tylenol(null)).post("/api/families/{f}/medications", d.family)
                .then().statusCode(201).extract().path("id");
        Map<String, Object> body = tylenol(null);
        body.put("name", "Tylenol Sinus");
        body.put("substances", List.of(Map.of("substance", "paracetamol", "concentration", "500 mg"),
                Map.of("substance", "cloridrato de pseudoefedrina", "concentration", "30 mg")));
        d.ana.req().body(body).put("/api/families/{f}/medications/{m}", d.family, id).then().statusCode(200)
                .body("substances", hasSize(2)).body("substances[1].concentration", equalTo("30 mg"));
        body.put("substances", List.of(Map.of("substance", "paracetamol"), Map.of("substance", "Paracetamol")));
        d.ana.req().body(body).put("/api/families/{f}/medications/{m}", d.family, id).then().statusCode(422)
                .body("code", equalTo("DUPLICATE_SUBSTANCE"));

        Dosing other = new Dosing();
        other.ana.req().get("/api/families/{f}/medications/{m}", other.family, id).then().statusCode(404);
        Map<String, Object> t = new HashMap<>();
        t.put("personId", other.person);
        t.put("name", "Tylenol");
        t.put("kind", "CONTINUOUS");
        t.put("prescribedDose", "1");
        t.put("startAt", Instant.now().toString());
        t.put("medicationId", id);
        other.ana.req().body(t).post("/api/families/{f}/treatments", other.family).then().statusCode(422)
                .body("code", equalTo("UNKNOWN_MEDICATION"));
    }

    @Test
    void anvisaCatalogOnlyActiveWithoutRepeatsAndConditionalDownload() throws Exception {
        d.ana.req().get("/api/catalog/medications").then().statusCode(200).body("version", nullValue());
        catalog.importFrom(Path.of("src/test/resources/anvisa-amostra.csv").toAbsolutePath().toUri().toString());

        var response = d.ana.req().get("/api/catalog/medications").then().statusCode(200).extract();
        String version = response.path("version");
        List<List<String>> items = response.path("items");
        assertEquals(10, items.size(), items.toString());
        assertTrue(items.contains(List.of("TYLENOL", "paracetamol", "KENVUE LTDA.", "Novo")), items.toString());
        assertTrue(items.stream().noneMatch(i -> i.get(0).equals("INSUMAN")), "inativo fica de fora");
        d.ana.req().header("If-None-Match", "\"" + version + "\"").get("/api/catalog/medications").then().statusCode(304);
    }
}
