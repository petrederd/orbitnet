FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202

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