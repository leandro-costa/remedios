package io.github.leandrocosta.remedios;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.test.junit.QuarkusTest;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

@QuarkusTest
class PersonTest {

    @Test
    void childWithoutAccountAndAdultWithAccount() {
        User ana = Api.newUser("Ana");
        User bruno = Api.newUser("Bruno");
        UUID family = Api.createFamily(ana, "Família");
        Api.join(family, ana, bruno);

        // Qualquer membro cadastra pessoas.
        bruno.req().body(person("Gabriel", "2019-03-10", null)).post("/api/families/{f}/persons", family)
                .then().statusCode(201)
                .body("displayName", equalTo("Gabriel"))
                .body("userId", nullValue())
                .body("active", equalTo(true));
        ana.req().body(person("Ana", null, ana.id())).post("/api/families/{f}/persons", family)
                .then().statusCode(201)
                .body("userId", equalTo(ana.id().toString()));

        ana.req().get("/api/families/{f}/persons", family).then().statusCode(200)
                .body("displayName", hasSize(2));
    }

    @Test
    void accountMustBelongToFamily() {
        User ana = Api.newUser("Ana");
        User eve = Api.newUser("Eve");
        UUID family = Api.createFamily(ana, "Família");

        ana.req().body(person("Eve", null, eve.id())).post("/api/families/{f}/persons", family)
                .then().statusCode(422).body("code", equalTo("USER_NOT_MEMBER"));
    }

    @Test
    void accountLinksToAtMostOneProfilePerFamily() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família");
        ana.req().body(person("Ana", null, ana.id())).post("/api/families/{f}/persons", family)
                .then().statusCode(201);
        String other = ana.req().body(person("Outra", null, null)).post("/api/families/{f}/persons", family)
                .then().statusCode(201).extract().path("id");

        ana.req().body(person("Ana 2", null, ana.id())).post("/api/families/{f}/persons", family)
                .then().statusCode(409).body("code", equalTo("USER_ALREADY_LINKED"));
        ana.req().body(person("Outra", null, ana.id())).put("/api/families/{f}/persons/{p}", family, other)
                .then().statusCode(409).body("code", equalTo("USER_ALREADY_LINKED"));
    }

    @Test
    void updateAndDeactivate() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família");
        String id = ana.req().body(person("Isa", null, null)).post("/api/families/{f}/persons", family)
                .then().statusCode(201).extract().path("id");

        Map<String, Object> change = person("Isabela", "2021-01-02", null);
        change.put("active", false);
        ana.req().body(change).put("/api/families/{f}/persons/{p}", family, id).then().statusCode(200)
                .body("displayName", equalTo("Isabela"))
                .body("birthDate", equalTo("2021-01-02"))
                .body("active", equalTo(false));

        ana.req().queryParam("active", true).get("/api/families/{f}/persons", family).then().statusCode(200)
                .body("id", hasSize(0));
    }

    @Test
    void rejectsFutureBirthDate() {
        User ana = Api.newUser("Ana");
        UUID family = Api.createFamily(ana, "Família");
        ana.req().body(person("Bebê", LocalDate.now().plusDays(3).toString(), null))
                .post("/api/families/{f}/persons", family)
                .then().statusCode(422).body("code", equalTo("INVALID_BIRTH_DATE"));
    }

    @Test
    void personsAreScopedToTheirFamily() {
        User ana = Api.newUser("Ana");
        User eve = Api.newUser("Eve");
        UUID family = Api.createFamily(ana, "Família A");
        UUID otherFamily = Api.createFamily(eve, "Família B");
        String id = ana.req().body(person("Gabriel", null, null)).post("/api/families/{f}/persons", family)
                .then().statusCode(201).extract().path("id");

        // Mesmo conhecendo o id, não se acessa a pessoa por outra família.
        eve.req().get("/api/families/{f}/persons/{p}", otherFamily, id).then().statusCode(404);
        eve.req().get("/api/families/{f}/persons/{p}", family, id).then().statusCode(404);
    }

    static Map<String, Object> person(String name, String birthDate, UUID userId) {
        Map<String, Object> body = new HashMap<>();
        body.put("displayName", name);
        body.put("birthDate", birthDate);
        body.put("userId", userId);
        return body;
    }
}
