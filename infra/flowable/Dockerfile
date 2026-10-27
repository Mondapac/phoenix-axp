# Phoenix's Flowable image (slice 2.1; PoC 3 verdicts R9, R11; ADR-0005). The official Flowable
# REST 7.1.0 image (Apache-2.0) already carries the PostgreSQL JDBC driver 42.7.4
# (BSD-2-Clause); this image adds Phoenix's settings and refuses to start without a PostgreSQL
# database of its own, so the same image runs in development, CI, on-prem and offline
# (`docker save` / `docker load`).
#
#   docker build -t phoenix/flowable-rest:7.1.0-phoenix.1 infra/flowable
#
# The base is pinned by digest. BASE_IMAGE may name a mirror or an offline registry, as long
# as the digest stays the same (CI pulls from mirror.gcr.io: Docker Hub rate-limits runners).
ARG BASE_IMAGE=flowable/flowable-rest:7.1.0@sha256:b7ae287502cd5c243b577a0ca2894172e1c18cd75aea4fd67dc7d58f1b40db44
FROM ${BASE_IMAGE}

# A base without the driver fails the build here, not at the first deployment.
RUN test -f /app/WEB-INF/lib/postgresql-42.7.4.jar

# One COPY: BuildKit gives the directory it creates the same mode, read and enter, never write.
COPY --chmod=0555 phoenix-entrypoint.sh phoenix-flowable.properties /opt/phoenix/

# Environment variables still override the file (Spring Boot's order), so a deployment tunes a
# value without a rebuild, e.g. FLOWABLE_PROCESS_ASYNC_EXECUTOR_DEFAULTTIMERJOBACQUIREWAITTIME.
ENV SPRING_CONFIG_ADDITIONAL_LOCATION=file:/opt/phoenix/phoenix-flowable.properties \
    JAVA_OPTS=-Xmx768m

# The engine answers only once it has its database and its schema: 11 to 20 s in PoC 3, more on
# a first start that creates the tables. Credentials come from the container's own environment.
HEALTHCHECK --interval=5s --timeout=3s --start-period=120s --retries=3 \
  CMD wget -q -O /dev/null "http://${FLOWABLE_REST_APP_ADMIN_USERID}:${FLOWABLE_REST_APP_ADMIN_PASSWORD}@127.0.0.1:${SERVER_PORT}/flowable-rest/service/management/engine" || exit 1

ENTRYPOINT ["/opt/phoenix/phoenix-entrypoint.sh"]
