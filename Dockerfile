FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /emrai ./cmd/emrai

# Install migrate for production migrations
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.18.1

FROM node:22-alpine AS frontend
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /emrai /emrai
COPY --from=builder /go/bin/migrate /usr/local/bin/migrate
COPY --from=frontend /build/.next /app/web/.next
COPY --from=frontend /build/public /app/web/public
COPY --from=frontend /build/node_modules /app/web/node_modules
COPY --from=frontend /build/package.json /app/web/package.json
COPY migrations /app/migrations
EXPOSE 8080
CMD ["/emrai"]
