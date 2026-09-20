FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
ARG SUPABASE_BROWSER_URL
ARG SUPABASE_BROWSER_PUBLISHABLE_VALUE
RUN VITE_SUPABASE_URL="$SUPABASE_BROWSER_URL" \
    VITE_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_BROWSER_PUBLISHABLE_VALUE" \
    npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
