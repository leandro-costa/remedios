package io.github.leandrocosta.remedios.user;

import io.quarkus.security.Authenticated;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Aparelhos do usuário atual. O id é escolhido pelo aparelho (PUT idempotente). */
@Path("/api/me/devices")
@Authenticated
public class DeviceResource {

    public record DeviceView(UUID id, Device.Platform platform, String name, Device.Status status,
            Instant createdAt, Instant lastSeenAt, Instant revokedAt) {

        static DeviceView of(Device d) {
            return new DeviceView(d.id, d.platform, d.name, d.status, d.createdAt, d.lastSeenAt, d.revokedAt);
        }
    }

    public record RegisterDevice(@NotNull Device.Platform platform, @Size(max = 120) String name) {
    }

    private final DeviceService devices;
    private final CurrentUser currentUser;

    public DeviceResource(DeviceService devices, CurrentUser currentUser) {
        this.devices = devices;
        this.currentUser = currentUser;
    }

    @GET
    public List<DeviceView> list() {
        return Device.listForUser(currentUser.id()).stream().map(DeviceView::of).toList();
    }

    @PUT
    @Path("/{deviceId}")
    public DeviceView register(@PathParam("deviceId") UUID deviceId, @Valid @NotNull RegisterDevice request) {
        return DeviceView.of(devices.register(deviceId, request.platform(), request.name()));
    }

    @DELETE
    @Path("/{deviceId}")
    public Response revoke(@PathParam("deviceId") UUID deviceId) {
        devices.revoke(deviceId);
        return Response.noContent().build();
    }
}
