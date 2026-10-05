FROM nginx:1.28-alpine
COPY infrastructure/coolify/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
