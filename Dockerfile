FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /janushc-dash ./cmd/janushc-dash

# Install migrate for production migrations
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.18.1

FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /janushc-dash /janushc-dash
COPY --from=builder /go/bin/migrate /usr/local/bin/migrate
COPY --from=frontend /build/dist /app/frontend/dist
COPY migrations /app/migrations
EXPOSE 8080
CMD ["/janushc-dash"]
