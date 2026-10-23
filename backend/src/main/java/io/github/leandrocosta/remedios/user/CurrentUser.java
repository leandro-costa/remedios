package io.github.leandrocosta.remedios.user;

import io.github.leandrocosta.remedios.common.Texts;
import jakarta.enterprise.context.RequestScoped;
import java.util.UUID;
import org.eclipse.microprofile.jwt.JsonWebToken;

/** Conta local do usuário autenticado na requisição atual. */
@RequestScoped
public class CurrentUser {

    private final JsonWebToken jwt;
    private final UserProvisioning provisioning;
    private AppUser user;

    public CurrentUser(JsonWebToken jwt, UserProvisioning provisioning) {
        this.jwt = jwt;
        this.provisioning = provisioning;
    }

    public AppUser get() {
        if (user == null) {
            String subject = jwt.getSubject();
            if (subject == null || subject.isBlank()) {
                throw new IllegalStateException("Token sem claim 'sub'.");
            }
            user = provisioning.ensure(subject, initialDisplayName());
        }
        return user;
    }

    public UUID id() {
        return get().id;
    }

    private String initialDisplayName() {
        for (String claim : new String[] { "name", "preferred_username", "email" }) {
            String value = Texts.clean(jwt.getClaim(claim));
            if (value != null) {
                return value;
            }
        }
        return "Responsável";
    }
}
