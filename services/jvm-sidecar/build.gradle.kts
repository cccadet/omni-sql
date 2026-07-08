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
    // Spike Fase 0: zero deps externos. Usamos com.sun.net.httpserver do JDK.
    // Em Fase 3 trocamos por Ktor (review Calcite será adicionada aqui).
    testImplementation(kotlin("test"))
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
    // Fat-jar simples para Fase 0: empacota sem deps porque ainda não há.
    archiveBaseName.set("omni-sql-sidecar")
    archiveVersion.set("0.0.1")
}