# No dependencies: only node:crypto, node:http and fetch.
FROM node:26-alpine
WORKDIR /app
COPY endpoints.js vapid.js server.js send.js ./
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
