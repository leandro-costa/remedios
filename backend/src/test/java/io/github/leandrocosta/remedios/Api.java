package io.github.leandrocosta.remedios;

import static io.restassured.RestAssured.given;

import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import io.smallrye.jwt.build.Jwt;
import java.util.Map;
import java.util.UUID;

/** Auxiliares de teste: usuários autenticados por JWT assinado com a chave de teste. */
public final class Api {

    private Api() {
    }

    public record User(String subject, String name, String token) {

        public RequestSpecification req() {
            return given().auth().oauth2(token).contentType(ContentType.JSON);
        }

        public UUID id() {
            return UUID.fromString(req().get("/api/me").then().statusCode(200).extract().path("id"));
        }
    }

    public static User newUser(String name) {
        String subject = "test|" + UUID.randomUUID();
        String token = Jwt.issuer("https://remedios.local/dev")
                .subject(subject)
                .claim("name", name)
                .sign();
        return new User(subject, name, token);
    }

    public static UUID createFamily(User owner, String name) {
        return UUID.fromString(owner.req().body(Map.of("name", name))
                .post("/api/families").then().statusCode(201).extract().path("id"));
    }

    /** Convida e faz {@code guest} aceitar, como membro comum. */
    public static void join(UUID familyId, User admin, User guest) {
        String code = admin.req().body(Map.of()).post("/api/families/{f}/invitations", familyId)
                .then().statusCode(201).extract().path("code");
        guest.req().body(Map.of("code", code)).post("/api/invitations/accept").then().statusCode(200);
    }
}
