package io.github.leandrocosta.remedios.common;

import jakarta.ws.rs.core.Response.Status;

/**
 * A versão-base informada pelo cliente não é a versão compartilhada atual.
 * Nada é aplicado; o cliente deve revisar a versão atual antes de reenviar
 * (seções 4.5 e 10.2).
 */
public class VersionConflictException extends ApiException {

    public final long currentVersion;

    public VersionConflictException(String what, long currentVersion) {
        super(Status.CONFLICT.getStatusCode(), "STALE_VERSION",
                what + " foi alterado(a) por outro responsável. Revise a versão atual antes de salvar.");
        this.currentVersion = currentVersion;
    }
}
