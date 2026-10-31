# Apify Actor Dockerfile for FinnBilGlass Catalog
FROM apify/actor-node:24

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including tsx for runtime)
RUN npm ci

# Copy actor source code
COPY actor-catalog.mjs ./
COPY .actor/actor.json ./.actor/actor.json

# Ensure non-root user
USER myuser

# Default command
CMD ["node", "--import", "tsx", "actor-catalog.mjs"]