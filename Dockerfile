FROM golang:1.25-alpine AS builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 go build -o /janushc-dash ./cmd/janushc-dash \
    && CGO_ENABLED=1 go build -o /batch-transcribe-recordings ./cmd/batch-transcribe-recordings \
    && CGO_ENABLED=1 go build -o /import-transcripts ./cmd/import-transcripts

# Install migrate for production migrations
RUN go install -tags 'sqlite3' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.18.1

FROM node:22-alpine AS frontend
ARG VITE_GOOGLE_CLIENT_ID
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM alpine:3.19
RUN apk add --no-cache ca-certificates ffmpeg
COPY --from=builder /janushc-dash /janushc-dash
COPY --from=builder /batch-transcribe-recordings /usr/local/bin/batch-transcribe-recordings
COPY --from=builder /import-transcripts /usr/local/bin/import-transcripts
COPY --from=builder /go/bin/migrate /usr/local/bin/migrate
COPY --from=frontend /build/dist /app/frontend/dist
COPY migrations /app/migrations
WORKDIR /app
EXPOSE 8080
CMD ["/janushc-dash"]
