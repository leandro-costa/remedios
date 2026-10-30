package io.github.leandrocosta.remedios.catalog;

import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.EntityTag;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;

/**
 * Catálogo de medicamentos da ANVISA para o aparelho guardar e consultar ao
 * digitar, inclusive sem conexão. O aparelho envia a versão que tem
 * ({@code If-None-Match}) e só recebe o catálogo de novo quando ele mudou.
 */
@Path("/api/catalog/medications")
@Authenticated
public class CatalogResource {

    /** Itens compactos: [nome, substâncias, fabricante, categoria]. */
    public record CatalogView(String version, Instant importedAt, List<List<String>> items) {
    }

    private final AnvisaCatalog catalog;

    public CatalogResource(AnvisaCatalog catalog) {
        this.catalog = catalog;
    }

    @GET
    public Response get(@HeaderParam("If-None-Match") String ifNoneMatch) {
        var info = catalog.info();
        if (info.isEmpty()) {
            return Response.ok(new CatalogView(null, null, List.of())).build();
        }
        EntityTag tag = new EntityTag(info.get().version());
        if (ifNoneMatch != null && ifNoneMatch.replace("\"", "").equals(info.get().version())) {
            return Response.notModified(tag).build();
        }
        List<List<String>> items = catalog.products().stream()
                .map(p -> java.util.Arrays.asList(p.name(), p.substances(), p.manufacturer(), p.category())).toList();
        return Response.ok(new CatalogView(info.get().version(), info.get().importedAt(), items)).tag(tag).build();
    }
}
