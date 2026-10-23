package io.github.leandrocosta.remedios;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.github.leandrocosta.remedios.Api.User;
import io.quarkus.test.junit.QuarkusTest;
import java.security.KeyPairGenerator;
import org.junit.jupiter.api.Test;

/** Validação dos ID tokens do Firebase (emissor, audiência, validade, assinatura). */
@QuarkusTest
class AuthTest {

    @Test
    void acceptsFirebaseTokenAndUsesUidAsAccount() {
        String token = Api.firebaseToken("uidDaAnaNoFirebase0000000001", "Ana").sign();
        String first = get(token).statusCode(200).body("displayName", equalTo("Ana")).extract().path("id");
        // Mesmo UID, nova sessão: mesma conta local.
        String again = Api.firebaseToken("uidDaAnaNoFirebase0000000001", "Ana").sign();
        get(again).statusCode(200).body("id", equalTo(first));
    }

    @Test
    void rejectsTokenFromAnotherFirebaseProject() {
        get(Api.firebaseToken("uid1", "Eve").audience("outro-projeto").sign()).statusCode(401);
        get(Api.firebaseToken("uid1", "Eve").issuer("https://securetoken.google.com/outro-projeto").sign())
                .statusCode(401);
    }

    @Test
    void rejectsExpiredToken() {
        long past = System.currentTimeMillis() / 1000 - 7200;
        get(Api.firebaseToken("uid2", "Eve").issuedAt(past).expiresAt(past + 3600).sign()).statusCode(401);
    }

    @Test
    void rejectsTokenSignedWithAnotherKey() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        get(Api.firebaseToken("uid3", "Eve").sign(generator.generateKeyPair().getPrivate())).statusCode(401);
    }

    @Test
    void rejectsMissingOrMalformedToken() {
        given().get("/api/me").then().statusCode(401);
        get("nao-e-um-jwt").statusCode(401);
    }

    @Test
    void healthIsPublic() {
        given().get("/q/health/ready").then().statusCode(200);
    }

    private static io.restassured.response.ValidatableResponse get(String token) {
        return new User("?", "?", token).req().get("/api/me").then();
    }
}
