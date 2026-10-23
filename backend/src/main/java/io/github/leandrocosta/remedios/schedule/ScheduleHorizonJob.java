package io.github.leandrocosta.remedios.schedule;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import org.jboss.logging.Logger;

/** Mantém as doses geradas até o horizonte configurado. */
@ApplicationScoped
public class ScheduleHorizonJob {

    private static final Logger LOG = Logger.getLogger(ScheduleHorizonJob.class);

    private final ScheduleService schedules;

    public ScheduleHorizonJob(ScheduleService schedules) {
        this.schedules = schedules;
    }

    @Scheduled(identity = "horizonte-da-agenda", every = "${remedios.schedule.extend-every}", delayed = "30s",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void run() {
        int created = schedules.extendAll();
        if (created > 0) {
            LOG.infof("Horizonte da agenda estendido: %d doses geradas.", created);
        }
    }
}
