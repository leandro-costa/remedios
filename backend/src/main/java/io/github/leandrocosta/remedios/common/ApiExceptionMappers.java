package io.github.leandrocosta.remedios.common;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

public class ApiExceptionMappers {

    @ServerExceptionMapper
    public Response map(ApiException e) {
        Object body = e instanceof VersionConflictException vc
                ? new ApiError(e.code, e.getMessage(), java.util.Map.of("currentVersion", vc.currentVersion))
                : new ApiError(e.code, e.getMessage());
        return Response.status(e.status).type(MediaType.APPLICATION_JSON).entity(body).build();
    }
}
