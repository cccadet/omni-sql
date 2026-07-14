#!/usr/bin/env bash
# Bootstrap gradle-wrapper para o spike da Fase 0.
# Baixa o gradle-wrapper.jar (~60KB) + escreve gradle-wrapper.properties +
# gradlew/gradlew.bat. Após rodar uma vez, basta `./gradlew run`.
set -euo pipefail
cd "$(dirname "$0")"

GRADLE_VERSION="8.12.1"
WRAPPER_DIR="gradle/wrapper"
WRAPPER_JAR="$WRAPPER_DIR/gradle-wrapper.jar"
WRAPPER_PROPS="$WRAPPER_DIR/gradle-wrapper.properties"

mkdir -p "$WRAPPER_DIR"

if [[ ! -f "$WRAPPER_JAR" ]]; then
  URL="https://raw.githubusercontent.com/gradle/gradle/v${GRADLE_VERSION}/gradle/wrapper/gradle-wrapper.jar"
  echo "baixando $URL"
  curl -fsSL "$URL" -o "$WRAPPER_JAR"
fi

cat > "$WRAPPER_PROPS" <<EOF
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF

cat > "gradlew" <<'EOF'
#!/bin/sh
# Gradle wrapper — gerado por bootstrap.sh
# JAVA_OPTS é respeitado (ex.: -Djavax.net.ssl.trustStoreType=Windows-ROOT
# em redes com inspeção SSL corporativa — ver README, secao Troubleshooting).
APP_HOME=$( cd "${0%/*}" > /dev/null && pwd )
CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
exec java $JAVA_OPTS -cp "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
EOF
chmod +x gradlew

cat > "gradlew.bat" <<'EOF'
@rem Gradle wrapper for Windows
@rem JAVA_OPTS e respeitado (ex.: -Djavax.net.ssl.trustStoreType=Windows-ROOT
@rem em redes com inspecao SSL corporativa — ver README, secao Troubleshooting).
@if "%DEBUG%"=="" @echo off
set DIRNAME=%~dp0
java %JAVA_OPTS% -cp "%DIRNAME%\gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
EOF

echo "ok. rode: ./gradlew run"
