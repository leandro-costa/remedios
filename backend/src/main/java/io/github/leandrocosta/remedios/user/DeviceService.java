package io.github.leandrocosta.remedios.user;

import io.github.leandrocosta.remedios.common.ApiException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.UUID;

@ApplicationScoped
public class DeviceService {

    private final CurrentUser currentUser;

    public DeviceService(CurrentUser currentUser) {
        this.currentUser = currentUser;
    }

    /** Registra o aparelho; repetir o registro com o mesmo id apenas atualiza o nome. */
    @Transactional
    public Device register(UUID id, Device.Platform platform, String name) {
        UUID userId = currentUser.id();
        Instant now = Instant.now();
        Device device = Device.findById(id);
        if (device == null) {
            device = new Device();
            device.id = id;
            device.userId = userId;
            device.platform = platform;
            device.status = Device.Status.ACTIVE;
            device.createdAt = now;
            device.persist();
        } else if (!device.userId.equals(userId)) {
            throw ApiException.conflict("DEVICE_ID_IN_USE", "Este identificador de aparelho já está em uso.");
        } else if (device.status == Device.Status.REVOKED) {
            throw ApiException.conflict("DEVICE_REVOKED",
                    "Este aparelho foi desconectado. Gere um novo identificador para registrá-lo de novo.");
        }
        device.name = name == null ? null : name.strip();
        device.lastSeenAt = now;
        return device;
    }

    @Transactional
    public void revoke(UUID id) {
        Device device = Device.findById(id);
        if (device == null || !device.userId.equals(currentUser.id())) {
            throw ApiException.notFound("Aparelho");
        }
        if (device.status == Device.Status.ACTIVE) {
            device.status = Device.Status.REVOKED;
            device.revokedAt = Instant.now();
            // Aparelho desconectado não recebe mais avisos.
            io.github.leandrocosta.remedios.push.PushSubscription.delete("deviceId", id);
        }
    }

    /** Aparelho ativo do usuário atual, exigido para registrar administrações. */
    @Transactional(Transactional.TxType.MANDATORY)
    public Device requireActive(UUID id) {
        Device device = id == null ? null : Device.findById(id);
        if (device == null || !device.userId.equals(currentUser.id())) {
            throw ApiException.unprocessable("DEVICE_NOT_REGISTERED",
                    "Registre este aparelho antes de registrar doses.");
        }
        if (device.status != Device.Status.ACTIVE) {
            throw ApiException.forbidden("Este aparelho foi desconectado da conta.");
        }
        device.lastSeenAt = Instant.now();
        return device;
    }
}
