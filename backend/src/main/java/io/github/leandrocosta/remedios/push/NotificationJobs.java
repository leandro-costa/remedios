package io.github.leandrocosta.remedios.push;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Instant;

/** Lembretes a cada minuto e publicação da outbox a cada poucos segundos. */
@ApplicationScoped
public class NotificationJobs {

    private final ReminderService reminders;
    private final OutboxPublisher outbox;

    public NotificationJobs(ReminderService reminders, OutboxPublisher outbox) {
        this.reminders = reminders;
        this.outbox = outbox;
    }

    @Scheduled(identity = "lembretes", every = "${remedios.reminders.every}", delayed = "20s",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void reminders() {
        reminders.tick(Instant.now());
    }

    @Scheduled(identity = "outbox", every = "${remedios.outbox.every}", delayed = "10s",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void outbox() {
        outbox.publish(Instant.now());
    }
}
