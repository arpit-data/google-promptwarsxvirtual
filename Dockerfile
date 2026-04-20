FROM node:20

WORKDIR /app

# Copy package files
COPY package.json ./
# If package-lock.json exists locally, it might be Windows-specific.
# We'll copy it but if it fails we have the option to remove it.
COPY package*.json ./

# Install dependencies
RUN rm -f package-lock.json && npm install

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]