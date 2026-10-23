package io.github.leandrocosta.remedios.common;

import jakarta.ws.rs.core.Response.Status;

/**
 * Erro de negócio exposto pela API com um código estável, para que o
 * aplicativo possa reagir sem depender do texto da mensagem.
 */
public class ApiException extends RuntimeException {

    public final int status;
    public final String code;

    public ApiException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static ApiException notFound(String what) {
        return new ApiException(Status.NOT_FOUND.getStatusCode(), "NOT_FOUND", what + " não encontrado(a).");
    }

    public static ApiException forbidden(String message) {
        return new ApiException(Status.FORBIDDEN.getStatusCode(), "FORBIDDEN", message);
    }

    public static ApiException conflict(String code, String message) {
        return new ApiException(Status.CONFLICT.getStatusCode(), code, message);
    }

    public static ApiException unprocessable(String code, String message) {
        return new ApiException(422, code, message);
    }
}
