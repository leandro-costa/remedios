package io.github.leandrocosta.remedios;

import static io.restassured.RestAssured.given;

import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import io.smallrye.jwt.build.Jwt;
import io.smallrye.jwt.build.JwtClaimsBuilder;
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

    /** ID do projeto Firebase usado nos testes (application.properties, perfil test). */
    public static final String PROJECT_ID = "remedios-test";

    public static User newUser(String name) {
        String subject = UUID.randomUUID().toString().replace("-", "").substring(0, 28);
        return new User(subject, name, firebaseToken(subject, name).sign());
    }

    /** Token com as claims de um ID token do Firebase Authentication. */
    public static JwtClaimsBuilder firebaseToken(String uid, String name) {
        long now = System.currentTimeMillis() / 1000;
        return Jwt.issuer("https://securetoken.google.com/" + PROJECT_ID)
                .audience(PROJECT_ID)
                .subject(uid)
                .claim("user_id", uid)
                .claim("auth_time", now)
                .claim("name", name)
                .claim("email", name.toLowerCase() + "@example.com")
                .claim("email_verified", true)
                .claim("firebase", Map.of("sign_in_provider", "google.com"))
                .issuedAt(now)
                .expiresAt(now + 3600);
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
