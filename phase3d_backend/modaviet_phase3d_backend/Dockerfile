FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY db ./db
COPY scripts ./scripts
EXPOSE 8080
CMD ["node", "src/server.js"]
