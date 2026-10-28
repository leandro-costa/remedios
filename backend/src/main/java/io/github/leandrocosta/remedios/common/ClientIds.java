package io.github.leandrocosta.remedios.common;

import java.util.UUID;
import java.util.function.Predicate;

/**
 * Ids de cadastros feitos no aparelho. Offline, o app gera o id para poder
 * referenciar o registro antes de enviá-lo (ex.: um tratamento para uma
 * pessoa cadastrada no mesmo período sem conexão).
 */
public final class ClientIds {

    private ClientIds() {
    }

    /** O id informado pelo aparelho, ou um novo. Um id já usado é recusado. */
    public static UUID choose(UUID requested, Predicate<UUID> exists) {
        if (requested == null) {
            return UUID.randomUUID();
        }
        if (exists.test(requested)) {
            throw ApiException.conflict("ID_IN_USE", "Este identificador já está em uso.");
        }
        return requested;
    }
}
