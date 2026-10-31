package io.github.leandrocosta.remedios.catalog;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;

/** Importa o catálogo da ANVISA logo depois de subir (se vazio) e o mantém atualizado. */
@ApplicationScoped
public class CatalogJobs {

    private final AnvisaCatalog catalog;

    public CatalogJobs(AnvisaCatalog catalog) {
        this.catalog = catalog;
    }

    @Scheduled(identity = "catalogo-anvisa", every = "6h", delayed = "5s",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void refresh() {
        catalog.refreshIfStale(Instant.now());
    }
}
