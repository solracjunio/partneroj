# No dependencies: only node:fs and node:http.
FROM node:26-alpine
WORKDIR /app
COPY collector.js ./
USER node
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "collector.js"]
