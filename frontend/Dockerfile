# Frontend image: build the Vite bundle with Node, serve it with nginx.
# Single responsibility: package the SPA. No app logic lives here.

# --- build stage -----------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /app

# Manifests first, so `npm ci` is only re-run when dependencies change
# rather than on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines import.meta.env at BUILD time, so the API base URL has to be
# present here -- it cannot be changed by setting an env var on the running
# container. Empty is the default and the right answer for docker-compose:
# requests stay same-origin and nginx proxies /api to the backend (see
# nginx.conf), which keeps CORS out of it entirely. Set it only when the API
# is served from a different origin, and rebuild:
#   docker compose build --build-arg VITE_API_BASE_URL=https://api.example.com frontend
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# --- runtime stage ---------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# The packaged default site would otherwise shadow ours.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Foreground, so the container's lifetime is nginx's lifetime.
CMD ["nginx", "-g", "daemon off;"]
