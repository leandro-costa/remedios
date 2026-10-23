package io.github.leandrocosta.remedios.user;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Entity
@Table(name = "app_user")
public class AppUser extends PanacheEntityBase {

    @Id
    public UUID id;

    @Column(name = "auth_subject", nullable = false, unique = true)
    public String authSubject;

    @Column(name = "display_name", nullable = false)
    public String displayName;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    public static Optional<AppUser> findBySubject(String subject) {
        return find("authSubject", subject).firstResultOptional();
    }
}
