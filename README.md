# omni-sql

One IDE for every database. Multi-database SQL IDE with intelligent
autocomplete (no LLM in v1).

## O que é

IDE desktop **local** (não é web app). Construída com Tauri: um binário nativo
que empacota um shell Rust + frontend Svelte + Monaco Editor + backend Node.
Suporta **Linux e Windows** (Tauri compila para ambos). Nada roda no navegador
na versão final — o modo `dev:frontend` abre no browser só para conveniência
durante o desenvolvimento.

## Pré-requisitos

| Ferramenta | Versão     | Notas |
|------------|------------|-------|
| Node.js    | >= 22      | Usa `node:sqlite` builtin |
| pnpm       | >= 11      | `npm i -g pnpm` ou via corepack |
| Rust       | stable     | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Tauri CLI  | 2.x        | `cargo install tauri-cli --version "^2.0" --locked` |
| Java (JDK) | >= 21      | Apenas para o JVM sidecar (Fase 3+) |
| Gradle     | >= 8       | Apenas para o JVM sidecar (Fase 3+) |

**Linux:** `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf libssl-dev` (deps do Tauri).

**Windows:** instale o [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) e o [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

### JVM sidecar (obrigatório para autocomplete tier2)

`pnpm dev:tauri` sobe normalmente sem o JVM sidecar, mas o autocomplete fica
travado em tier1 (sem resolução de colunas de CTE) e só um log `INFO` no
console avisa disso. Para habilitar o tier2, gere o jar **antes** de rodar
`pnpm dev:tauri`:

```powershell
# Windows (PowerShell)
winget install --id EclipseAdoptium.Temurin.21.JDK -e   # se ainda não tiver JDK 21
java -version                                             # em um terminal novo, para o PATH atualizar
cd services\jvm-sidecar
.\gradlew.bat jar
```

```bash
# Linux/macOS
cd services/jvm-sidecar
ls -l bootstrap.sh gradlew
chmod +x bootstrap.sh gradlew
./bootstrap.sh    # only first time, generates Gradle wrapper
./gradlew jar
```

O jar fica em `services/jvm-sidecar/build/libs/omni-sql-sidecar.jar` e é
detectado automaticamente pelo Tauri no próximo `pnpm dev:tauri`. Rode
`./gradlew jar` de novo sempre que mexer em `Main.kt`. Se o build falhar com
`PKIX path building failed` (rede corporativa com SSL inspection), veja
`services/jvm-sidecar/README.md#troubleshooting-ssl-ao-baixar-a-distribuição-do-gradle`.

## Instalação

```bash
git clone https://github.com/cccadet/omni-sql.git
cd omni-sql
pnpm install
```

## Desenvolvimento

### Desktop completo (recomendado)

Abre a janela nativa do Tauri com backend Node sidecar embutido:

```bash
pnpm dev:tauri
```

Isto sobe o Vite (frontend), o backend Node (JSON-RPC na porta 41920) e o
shell Tauri que renderiza a janela desktop.

### Frontend isolado (browser, só para dev rápido)

```bash
pnpm dev:frontend   # http://localhost:1420
pnpm dev:backend    # http://localhost:41920/rpc (JSON-RPC)
```

## Build

Gera um binário instalável (.deb/.rpm/.AppImage no Linux; .msi/.exe no Windows):

```bash
pnpm build:tauri
```

Os artefatos ficam em `apps/desktop/src-tauri/target/release/bundle/`.

## Verificação (typecheck + lint + testes)

```bash
pnpm verify          # todos os pacotes TS (typecheck + lint + test)
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # Rust shell
```

## Arquitetura

```
Tauri Shell (Rust)
  ├─ Svelte 5 + Monaco Editor (frontend)
  └─ Node backend (TS) — JSON-RPC HTTP localhost:41920
       ├─ Adapters: PostgreSQL ✅ | MySQL/MariaDB/SQLServer/Oracle ⏳ | JDBC/ODBC ⏳
       ├─ Metadata cache: SQLite (node:sqlite builtin) com last_synced_at
       └─ Autocomplete engine: lexer tier1 ✅ | Calcite tier2 ✅ (colunas de CTE)
  └─ JVM sidecar (Kotlin, opcional) — HTTP localhost:41921
       └─ Apache Calcite: /scope/resolve resolve colunas de `WITH x AS (...)`
```

Veja `PROJECT_PLAN.md` para o roadmap completo e `AGENTS.md` para detalhes
técnicos.

## Estado atual

- ✅ Fase 0: Fundação (monorepo, Tauri, Monaco, results grid, CI)
- ✅ Fase 1: Cache SQLite + modelo unificado de metadados
- ✅ Fase 2: Adaptador PostgreSQL real + lexer tier1 (casos 1-6)
- ✅ Fase 3: Colunas de CTE via Apache Calcite (`/scope/resolve` no sidecar JVM)
- ⏳ Fases 4-7: Demais bancos (MySQL, Oracle, SQL Server, JDBC, ODBC)
- ⏳ Fase 9: Polimento transversal

## Licença

MIT