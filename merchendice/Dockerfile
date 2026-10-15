FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts ./scripts
COPY src ./src
COPY index.html site.css site.js examples.js ./
COPY examples ./examples
COPY examplepage.com ./examplepage.com
COPY enquiry ./enquiry
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src ./src
COPY --chown=node:node package.json server.mjs ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
