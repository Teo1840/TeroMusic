# Se construye desde la raiz del repo (ver docker-compose.yml) para copiar contracts/.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY services/rooms_service/package.json services/rooms_service/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY services/rooms_service/src ./src
COPY services/rooms_service/test ./test
COPY contracts ./contracts
USER node
EXPOSE 8000
CMD ["node", "src/index.js"]
