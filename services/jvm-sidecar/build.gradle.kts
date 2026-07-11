import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    kotlin("jvm") version "2.1.0"
    application
}

group = "dev.omnisql"
version = "0.0.1"

repositories {
    mavenCentral()
}

dependencies {
    // Fase 3: Calcite para parsing real de SQL (extração de colunas de CTE
    // via SqlParser, sem depender de schema/catálogo — só sintático). Ainda
    // sem Ktor: o HTTP server continua com.sun.net.httpserver do JDK.
    implementation("org.apache.calcite:calcite-core:1.37.0")
    // slf4j-nop: Calcite loga via SLF4J; sem um binding, cada boot imprime o
    // aviso "SLF4J: No SLF4J providers were found" no stderr do sidecar.
    runtimeOnly("org.slf4j:slf4j-nop:2.0.13")
    // JSON leve para o corpo de /scope/resolve — evita reescrever
    // encode/escape de string à mão (nomes de coluna citados podem conter
    // aspas, unicode etc.).
    implementation("org.json:json:20240303")
    testImplementation(kotlin("test"))
    // Só de teste: driver JDBC real e embutido pra validar carregamento
    // dinâmico de jar (JdbcConnectionManagerTest) sem precisar de um banco
    // externo nem de um jar fixture no repo.
    testImplementation("com.h2database:h2:2.2.224")
}

application {
    mainClass.set("dev.omnisql.sidecar.MainKt")
}

tasks.withType<KotlinCompile> {
    kotlinOptions {
        jvmTarget = "21"
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

tasks.jar {
    manifest {
        attributes(
            "Main-Class" to "dev.omnisql.sidecar.MainKt",
        )
    }
    // Fat-jar de verdade: embute o kotlin-stdlib no jar. Sem isso, `java -jar`
    // sobe e faz bind normal (main() não toca classes do Kotlin runtime), mas
    // quebra silenciosamente na PRIMEIRA request: o handler (lambda) referencia
    // kotlin.text.Charsets/Intrinsics, que só resolvem em runtime — sem stdlib
    // no classpath dá NoClassDefFoundError, e o HttpServer do JDK engole essa
    // exceção fechando a conexão sem resposta e sem log nenhum (muito difícil
    // de diagnosticar: o processo "parece" saudável, só não responde nunca).
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    // Calcite traz dependências assinadas (jars com META-INF/*.SF,*.RSA); ao
    // mesclar tudo num fat-jar essas assinaturas ficam órfãs (não cobrem mais
    // o conteúdo real do jar final) e a JVM recusa a carregar QUALQUER classe
    // com `SecurityException: Invalid signature file digest`. Sem exclusão, o
    // sidecar nem sobe.
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/*.EC")
    // Sem sufixo de versão: o Tauri (lib.rs) invoca este jar por nome fixo
    // via `java -jar`, sem passar pelo Gradle/Daemon em tempo de execução.
    archiveBaseName.set("omni-sql-sidecar")
    archiveVersion.set("")
}