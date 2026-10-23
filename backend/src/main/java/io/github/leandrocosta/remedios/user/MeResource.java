package io.github.leandrocosta.remedios.user;

import io.github.leandrocosta.remedios.common.ApiException;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

@Path("/api/me")
@Authenticated
public class MeResource {

    public record UserView(UUID id, String displayName) {
        static UserView of(AppUser user) {
            return new UserView(user.id, user.displayName);
        }
    }

    public record UpdateMe(@NotBlank @Size(max = 120) String displayName) {
    }

    public record NotificationSettingsView(
            @NotNull Boolean soundEnabled,
            @NotNull Boolean vibrationEnabled,
            @NotNull Boolean earlyReminderEnabled,
            @Min(1) @Max(1440) Integer repeatIntervalMinutes,
            @NotNull Boolean confirmationNotifications,
            @NotNull Boolean quietHoursEnabled,
            LocalTime quietHoursStart,
            LocalTime quietHoursEnd,
            @NotNull UserNotificationSettings.SyncNoticeMode syncNoticeMode,
            @NotNull Boolean lockScreenDetails) {

        static NotificationSettingsView of(UserNotificationSettings s) {
            return new NotificationSettingsView(s.soundEnabled, s.vibrationEnabled, s.earlyReminderEnabled,
                    s.repeatIntervalMinutes, s.confirmationNotifications, s.quietHoursEnabled, s.quietHoursStart,
                    s.quietHoursEnd, s.syncNoticeMode, s.lockScreenDetails);
        }
    }

    private final CurrentUser currentUser;

    public MeResource(CurrentUser currentUser) {
        this.currentUser = currentUser;
    }

    @GET
    public UserView me() {
        return UserView.of(currentUser.get());
    }

    @PUT
    @Transactional
    public UserView update(@Valid @NotNull UpdateMe request) {
        AppUser user = AppUser.findById(currentUser.id());
        user.displayName = request.displayName().strip();
        return UserView.of(user);
    }

    @GET
    @Path("/notification-settings")
    public NotificationSettingsView notificationSettings() {
        return NotificationSettingsView.of(UserNotificationSettings.forUser(currentUser.id()));
    }

    @PUT
    @Path("/notification-settings")
    @Transactional
    public NotificationSettingsView updateNotificationSettings(@Valid @NotNull NotificationSettingsView request) {
        if (request.quietHoursEnabled() && (request.quietHoursStart() == null || request.quietHoursEnd() == null)) {
            throw ApiException.unprocessable("QUIET_HOURS_INCOMPLETE",
                    "Informe início e fim do horário de silêncio.");
        }
        UserNotificationSettings s = UserNotificationSettings.forUser(currentUser.id());
        s.soundEnabled = request.soundEnabled();
        s.vibrationEnabled = request.vibrationEnabled();
        s.earlyReminderEnabled = request.earlyReminderEnabled();
        s.repeatIntervalMinutes = request.repeatIntervalMinutes();
        s.confirmationNotifications = request.confirmationNotifications();
        s.quietHoursEnabled = request.quietHoursEnabled();
        s.quietHoursStart = request.quietHoursStart();
        s.quietHoursEnd = request.quietHoursEnd();
        s.syncNoticeMode = request.syncNoticeMode();
        s.lockScreenDetails = request.lockScreenDetails();
        s.updatedAt = Instant.now();
        if (!s.isPersistent()) {
            s.persist();
        }
        return NotificationSettingsView.of(s);
    }
}
