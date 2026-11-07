# The GASP Standard MCP server as a hosted Streamable HTTP endpoint.
# Installs the published npm package, so the image tracks releases rather than
# this tree; build from the tree instead with `npm run build && npm run serve`.
#
#   docker build -t gasp-standard-mcp .
#   docker run -p 3000:3000 -e MCP_ALLOWED_HOSTS=mcp.gaspwiki.com gasp-standard-mcp
#
# The endpoint is /mcp; / and /health answer with the version and tool count.
FROM node:22-alpine
ARG GASP_MCP_VERSION=latest
RUN npm install -g "gasp-standard-mcp@${GASP_MCP_VERSION}" && npm cache clean --force
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 MCP_PATH=/mcp
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["gasp-standard-mcp-http"]
