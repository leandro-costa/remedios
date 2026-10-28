# syntax=docker/dockerfile:1

# --- Build ------------------------------------------------------------------
FROM maven:3.10.0-eclipse-temurin-27 AS build
WORKDIR /src
COPY pom.xml .
COPY src src
# Os testes exigem PostgreSQL; rodam no serviço "tests" do compose.
RUN --mount=type=cache,target=/root/.m2 mvn -B package -DskipTests

# --- Execução ---------------------------------------------------------------
FROM eclipse-temurin:27_35-jre
WORKDIR /app
COPY --from=build --chown=1001:1001 /src/target/quarkus-app/ ./
USER 1001
EXPOSE 8010
ENTRYPOINT ["java", "-jar", "quarkus-run.jar"]
