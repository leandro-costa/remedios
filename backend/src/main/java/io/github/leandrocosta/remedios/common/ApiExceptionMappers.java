package io.github.leandrocosta.remedios.common;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

public class ApiExceptionMappers {

    @ServerExceptionMapper
    public Response map(ApiException e) {
        ApiError body = new ApiError(e.code, e.getMessage(), e.details);
        return Response.status(e.status).type(MediaType.APPLICATION_JSON).entity(body).build();
    }
}
