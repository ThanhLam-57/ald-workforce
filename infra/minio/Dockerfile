# MinIO Community Edition is source-only after 2025-10.
FROM golang:1.24.8-alpine3.22 AS build
RUN apk add --no-cache git
RUN CGO_ENABLED=0 go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM alpine:3.22
RUN apk add --no-cache ca-certificates curl \
    && addgroup -g 1001 -S minio \
    && adduser -u 1001 -S minio -G minio \
    && mkdir -p /data \
    && chown -R minio:minio /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
