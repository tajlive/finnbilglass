FROM apify/actor-node-playwright-chrome:22-slim

# A lockfile is created by the Mac installer, checked in the upload context, and
# used by npm ci. No silently changing dependency tree on subsequent builds.
COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional --no-fund \
    && npm audit --omit=dev --omit=optional --audit-level=high \
    && npm cache clean --force

COPY --chown=myuser:myuser . ./
CMD ["npm", "start", "--silent"]
