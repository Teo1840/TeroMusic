FROM nginx:alpine

# Certificado autofirmado para la terminación TLS en el gateway (solo desarrollo).
# Se genera al construir la imagen y vale para localhost y 127.0.0.1.
# En producción se monta uno real en /etc/nginx/certs (mismo nombre de archivos).
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
        -keyout /etc/nginx/certs/gateway.key -out /etc/nginx/certs/gateway.crt \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,DNS:gateway,IP:127.0.0.1" \
    && chmod 600 /etc/nginx/certs/gateway.key

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443
