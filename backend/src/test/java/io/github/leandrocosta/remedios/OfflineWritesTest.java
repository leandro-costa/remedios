package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.test.junit.QuarkusTest;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Gravações vindas da fila offline: ids do aparelho e reenvio seguro (seção 10.1). */
@QuarkusTest
class OfflineWritesTest {

    @Test
    void reenvioComAMesmaChaveDevolveOMesmoResultadoSemRepetir() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família Offline");
        UUID personId = UUID.randomUUID();
        UUID op = UUID.randomUUID();
        Map<String, Object> body = Map.of("id", personId, "displayName", "Gabriel");

        String first = ana.req().header("Idempotency-Key", op.toString()).body(body)
                .post("/api/families/{f}/persons", family).then().statusCode(201)
                .body("id", equalTo(personId.toString())).extract().asString();
        String again = ana.req().header("Idempotency-Key", op.toString()).body(body)
                .post("/api/families/{f}/persons", family).then().statusCode(201)
                .header("Idempotent-Replay", "true").extract().asString();
        assertEquals(first, again);
        ana.req().get("/api/families/{f}/persons", family).then().body("$", hasSize(1));

        // Alteração reenviada: aplicada uma vez só.
        UUID update = UUID.randomUUID();
        for (int i = 0; i < 2; i++) {
            ana.req().header("Idempotency-Key", update.toString())
                    .body(Map.of("displayName", "Gabriel Souza"))
                    .put("/api/families/{f}/persons/{p}", family, personId).then().statusCode(200)
                    .body("displayName", equalTo("Gabriel Souza"));
        }
    }

    @Test
    void erroDeNegocioTambemEhGuardadoEChaveNaoServeParaOutroPedido() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família Offline");
        UUID op = UUID.randomUUID();
        for (int i = 0; i < 2; i++) {
            ana.req().header("Idempotency-Key", op.toString()).body(Map.of("displayName", " "))
                    .post("/api/families/{f}/persons", family).then().statusCode(400);
        }
        ana.req().header("Idempotency-Key", op.toString()).body(Map.of("name", "Outra"))
                .post("/api/families").then().statusCode(422).body("code", equalTo("IDEMPOTENCY_KEY_REUSED"));
        ana.req().header("Idempotency-Key", "nao-e-uuid").body(Map.of("name", "Outra"))
                .post("/api/families").then().statusCode(400).body("code", equalTo("INVALID_IDEMPOTENCY_KEY"));
    }

    @Test
    void chaveEhPorUsuario() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        UUID op = UUID.randomUUID();
        ana.req().header("Idempotency-Key", op.toString()).body(Map.of("name", "Da Ana"))
                .post("/api/families").then().statusCode(201).body("name", equalTo("Da Ana"));
        bruno.req().header("Idempotency-Key", op.toString()).body(Map.of("name", "Do Bruno"))
                .post("/api/families").then().statusCode(201).body("name", equalTo("Do Bruno"));
    }

    @Test
    void cadastrosOfflineReferenciamIdsGeradosNoAparelho() {
        User ana = Api.newUser("Ana");
        UUID family = UUID.randomUUID();
        ana.req().body(Map.of("id", family, "name", "Família do aparelho"))
                .post("/api/families").then().statusCode(201).body("id", equalTo(family.toString()));

        UUID person = UUID.randomUUID();
        ana.req().body(Map.of("id", person, "displayName", "Gabriel"))
                .post("/api/families/{f}/persons", family).then().statusCode(201);

        UUID treatment = UUID.randomUUID();
        Map<String, Object> t = new HashMap<>();
        t.put("id", treatment);
        t.put("personId", person);
        t.put("name", "Amoxicilina");
        t.put("kind", "OCCASIONAL");
        t.put("prescribedDose", "5 ml");
        t.put("startAt", "2030-01-01T11:00:00Z");
        ana.req().body(t).post("/api/families/{f}/treatments", family).then().statusCode(201)
                .body("id", equalTo(treatment.toString()));

        UUID reminder = UUID.randomUUID();
        ana.req().body(Map.of("id", reminder, "message", "Medir a temperatura",
                "remindAt", java.time.Instant.now().plusSeconds(3600).toString()))
                .post("/api/families/{f}/persons/{p}/reminders", family, person).then().statusCode(200)
                .body("id", equalTo(reminder.toString()));

        // Sem a chave de operação, um id repetido é recusado.
        ana.req().body(Map.of("id", person, "displayName", "Outra pessoa"))
                .post("/api/families/{f}/persons", family).then().statusCode(409).body("code", equalTo("ID_IN_USE"));
    }
}
