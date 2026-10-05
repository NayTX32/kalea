# KALEA — image de production (zéro dépendance, une seule couche)
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

# Les sources seulement : pas de node_modules (aucune dépendance npm).
COPY package.json ./
COPY server ./server
COPY public ./public
COPY tools ./tools

# Répertoire persistant pour SQLite (à monter en volume).
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 4000

# L'hébergeur peut surcharger PORT.
CMD ["node", "server/index.js"]
