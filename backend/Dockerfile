FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/server.js backend/external-check.js ./
# Shared with site/tools/developer/security-headers.html so both tools use the
# same HSTS/CSP/frame-ancestors rules.
COPY site/assets/js/security-header-rules.js ./site/assets/js/security-header-rules.js

ENV PORT=3000

EXPOSE 3000

# Run as the unprivileged user that ships with the Node image.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]