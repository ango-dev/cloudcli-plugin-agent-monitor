# CloudCLI with three staged Claude Code sessions, to try Agent Monitor on Linux
# and to take the README screenshots. See dev/demo/README.md.
FROM node:22
ARG CLOUDCLI_VERSION=1.37.3
RUN npm install -g @cloudcli-ai/cloudcli@${CLOUDCLI_VERSION} && npm cache clean --force
COPY --chown=node:node cloudcli-demo.mjs fake-claude.mjs terminal.mjs start.sh /demo/
USER node
WORKDIR /home/node
CMD ["sh", "/demo/start.sh"]
