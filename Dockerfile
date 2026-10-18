FROM node:22-alpine
WORKDIR /app
COPY server/ ./server/
COPY site/ ./site/
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server/server.js"]
