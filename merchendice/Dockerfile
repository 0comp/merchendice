FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY scripts ./scripts
COPY src ./src
COPY index.html site.css site.js robots.txt sitemap.xml favicon.svg favicon.ico apple-touch-icon.png og.png 404.html ./
COPY examples ./examples
COPY example-store ./example-store
COPY enquiry ./enquiry
COPY privacy ./privacy
COPY about ./about
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src ./src
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node fonts ./fonts
COPY --chown=node:node images ./images
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
