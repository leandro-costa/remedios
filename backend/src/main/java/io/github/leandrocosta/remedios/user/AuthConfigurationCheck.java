package io.github.leandrocosta.remedios.user;

import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Singleton;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Impede a API de subir em produção sem a configuração do Firebase. Sem a
 * audiência, tokens de qualquer projeto Firebase poderiam ser aceitos.
 */
@Singleton
public class AuthConfigurationCheck {

    static final String GOOGLE_JWKS =
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

    private static final Logger LOG = Logger.getLogger(AuthConfigurationCheck.class);

    @ConfigProperty(name = "mp.jwt.verify.audiences")
    Optional<String> audiences;

    @ConfigProperty(name = "mp.jwt.verify.issuer")
    Optional<String> issuer;

    @ConfigProperty(name = "mp.jwt.verify.publickey.location")
    Optional<String> keyLocation;

    void onStart(@Observes StartupEvent event) {
        if (LaunchMode.current() != LaunchMode.NORMAL) {
            return;
        }
        if (audiences.filter(a -> !a.isBlank()).isEmpty()) {
            throw new IllegalStateException(
                    "Autenticação não configurada: defina FIREBASE_PROJECT_ID com o ID do projeto Firebase.");
        }
        if (!keyLocation.map(GOOGLE_JWKS::equals).orElse(false)) {
            LOG.warnf("Tokens validados com a chave %s em vez das chaves do Firebase. "
                    + "Use isso apenas em ambiente local.", keyLocation.orElse("?"));
        } else {
            LOG.infof("Autenticação via Firebase: emissor %s, audiência %s.", issuer.orElse("?"),
                    audiences.get());
        }
    }
}
