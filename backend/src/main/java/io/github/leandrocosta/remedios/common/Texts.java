package io.github.leandrocosta.remedios.common;

public final class Texts {

    private Texts() {
    }

    /** Remove espaços nas extremidades; texto vazio vira null. */
    public static String clean(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.strip();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
