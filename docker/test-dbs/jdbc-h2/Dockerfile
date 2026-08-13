# Banco "JDBC custom" para os testes de integração: H2 em modo servidor TCP.
# Não há adaptador nativo H2 no omni-sql — a conexão só é possível via
# jdbc-generic (jar do driver apontado pelo usuário), exercitando de ponta a
# ponta o carregamento dinâmico de jars do JdbcConnectionManager no sidecar JVM.
FROM eclipse-temurin:21-jre

ARG H2_VERSION=2.3.232
ADD https://repo1.maven.org/maven2/com/h2database/h2/${H2_VERSION}/h2-${H2_VERSION}.jar /opt/h2.jar

EXPOSE 9092

# O jar também é copiado para /drivers (bind mount do host) a cada boot — o
# sidecar JVM roda fora do Docker e precisa do MESMO jar em disco para o
# options.jarPath da conexão jdbc-generic.
# -tcpAllowOthers: conexões chegam via gateway do Docker (porta publicada),
# não via localhost do container.
# -ifNotExists: healthcheck/RunScript criam o banco `omni_test` no 1º acesso.
CMD ["sh", "-c", "(cp -f /opt/h2.jar /drivers/h2.jar && chmod 644 /drivers/h2.jar) 2>/dev/null || true; exec java -cp /opt/h2.jar org.h2.tools.Server -tcp -tcpAllowOthers -ifNotExists -baseDir /data"]
