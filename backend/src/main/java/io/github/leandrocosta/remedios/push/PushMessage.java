package io.github.leandrocosta.remedios.push;

import java.util.List;

/**
 * Conteúdo entregue ao service worker do app. {@code tag} agrupa as
 * notificações de uma mesma dose: a mais nova substitui a anterior.
 */
public record PushMessage(String title, String body, String tag, String url, boolean silent, boolean renotify,
        List<Integer> vibrate) {
}
