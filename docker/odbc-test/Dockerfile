FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends unixodbc libsqliteodbc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY . .
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate && pnpm install --frozen-lockfile

ENV OMNI_SQL_RUN_ODBC_INTEGRATION=1
ENV OMNI_SQL_ODBC_SQLITE_PATH=/tmp/omni-odbc.sqlite
CMD ["pnpm", "--filter", "@omni-sql/adapters-odbc", "test:integration"]
