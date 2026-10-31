package io.github.leandrocosta.remedios.treatment;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;
import org.jboss.logging.Logger;

/** Encerra os itens cujo período terminou (e as receitas, com seus itens "se necessário"). */
@ApplicationScoped
public class TreatmentEndJob {

    private static final Logger LOG = Logger.getLogger(TreatmentEndJob.class);

    private final TreatmentService treatments;

    public TreatmentEndJob(TreatmentService treatments) {
        this.treatments = treatments;
    }

    @Scheduled(identity = "fim-do-periodo", every = "${remedios.schedule.extend-every}", delayed = "45s",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void run() {
        run(Instant.now());
    }

    public int run(Instant now) {
        int ended = 0;
        for (var id : io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().call(() -> treatments.finished(now))) {
            try {
                if (treatments.endIfFinished(id, now)) {
                    ended++;
                }
            } catch (RuntimeException e) {
                LOG.errorf(e, "Falha ao encerrar o tratamento %s", id);
            }
        }
        if (ended > 0) {
            LOG.infof("Itens encerrados ao fim do período: %d.", ended);
        }
        return ended;
    }
}
