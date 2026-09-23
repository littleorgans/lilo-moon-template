# The runtime image for services/api. Built by `moon run api:container`, whose build context is the
# `pnpm deploy` output in out/: dist plus production node_modules, with the workspace libraries
# copied in as their built dist. Nothing is compiled or installed in here.
#
# Node matches .moon/toolchains.yml. The digest pins the multi-platform index; Renovate's
# dockerfile manager updates tag and digest together, grouped with the other Node pins.
FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

ENV NODE_ENV=production
WORKDIR /app
# Owned by root and readable by everyone, so the process cannot rewrite its own code or modules.
# Nothing here is written at runtime. Only the process runs as `node`.
COPY . .
USER node

# PORT, DATABASE_URL and WORKOS_CLIENT_ID come from the orchestrator. `docker stop` sends SIGTERM,
# which drains in-flight requests and closes the pool before the process exits on its own.
CMD ["node", "dist/main.js"]
