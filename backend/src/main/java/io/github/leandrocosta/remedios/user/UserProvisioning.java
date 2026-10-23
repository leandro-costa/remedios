package io.github.leandrocosta.remedios.user;

import io.quarkus.hibernate.orm.panache.Panache;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.UUID;

/**
 * Cria a conta local no primeiro acesso de um sujeito autenticado. Usa
 * INSERT ... ON CONFLICT para que requisições simultâneas do mesmo usuário
 * não falhem.
 */
@ApplicationScoped
public class UserProvisioning {

    @Transactional
    public AppUser ensure(String subject, String displayName) {
        return AppUser.findBySubject(subject).orElseGet(() -> {
            Panache.getEntityManager()
                    .createNativeQuery("""
                            INSERT INTO app_user (id, auth_subject, display_name, created_at)
                            VALUES (:id, :subject, :name, now())
                            ON CONFLICT (auth_subject) DO NOTHING
                            """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("subject", subject)
                    .setParameter("name", displayName)
                    .executeUpdate();
            return AppUser.findBySubject(subject).orElseThrow();
        });
    }
}
