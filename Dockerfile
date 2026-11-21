# Hosted packhouse instance: the built app + packhouse server + PostgREST + PostgreSQL client tools (backups).
# Data lives only in the external permanent PostgreSQL named by DATABASE_URL; this container keeps nothing.
FROM node:20-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN VITE_SUPABASE_URL=same-origin VITE_SUPABASE_ANON_KEY=packhouse-anon VITE_PACKHOUSE_SERVER=1 npx vite build --outDir /out/dist --emptyOutDir

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
 && curl -fsSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz -o /tmp/pgrst.tar.xz \
 && echo "9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c  /tmp/pgrst.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/pgrst.tar.xz -C /usr/local/bin && rm /tmp/pgrst.tar.xz \
 && apt-get purge -y gnupg xz-utils && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm init -y >/dev/null && npm install --no-audit --no-fund pg@8.16.3 >/dev/null
COPY server ./server
COPY deploy ./deploy
COPY supabase/migrations ./supabase/migrations
COPY supabase/seed ./supabase/seed
COPY supabase/appliance ./supabase/appliance
COPY scripts/appliance-demo-users.mjs scripts/demo-people.mjs ./scripts/
COPY --from=build /out/dist ./dist
RUN chmod +x deploy/start.sh
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["bash", "deploy/start.sh"]
