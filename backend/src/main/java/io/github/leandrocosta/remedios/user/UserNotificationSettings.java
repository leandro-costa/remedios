package io.github.leandrocosta.remedios.user;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

/** Preferências pessoais de notificação (seção 6.4). Não afetam a agenda. */
@Entity
@Table(name = "user_notification_settings")
public class UserNotificationSettings extends PanacheEntityBase {

    public enum SyncNoticeMode { NOTIFY, SILENT }

    @Id
    @Column(name = "user_id")
    public UUID userId;

    @Column(name = "sound_enabled", nullable = false)
    public boolean soundEnabled = true;

    @Column(name = "vibration_enabled", nullable = false)
    public boolean vibrationEnabled = true;

    @Column(name = "early_reminder_enabled", nullable = false)
    public boolean earlyReminderEnabled = true;

    @Column(name = "repeat_interval_minutes")
    public Integer repeatIntervalMinutes;

    @Column(name = "confirmation_notifications", nullable = false)
    public boolean confirmationNotifications = false;

    @Column(name = "quiet_hours_enabled", nullable = false)
    public boolean quietHoursEnabled = false;

    @Column(name = "quiet_hours_start")
    public LocalTime quietHoursStart;

    @Column(name = "quiet_hours_end")
    public LocalTime quietHoursEnd;

    @Enumerated(EnumType.STRING)
    @Column(name = "sync_notice_mode", nullable = false)
    public SyncNoticeMode syncNoticeMode = SyncNoticeMode.NOTIFY;

    @Column(name = "lock_screen_details", nullable = false)
    public boolean lockScreenDetails = false;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    /** Preferências gravadas, ou os padrões caso o usuário nunca as tenha alterado. */
    public static UserNotificationSettings forUser(UUID userId) {
        UserNotificationSettings settings = findById(userId);
        if (settings == null) {
            settings = new UserNotificationSettings();
            settings.userId = userId;
        }
        return settings;
    }
}
