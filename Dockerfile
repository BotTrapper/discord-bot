FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "dist/index.js"]
