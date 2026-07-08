@rem Gradle wrapper for Windows
@rem JAVA_OPTS e respeitado (ex.: -Djavax.net.ssl.trustStoreType=Windows-ROOT
@rem em redes com inspecao SSL corporativa — ver README, secao Troubleshooting).
@if "%DEBUG%"=="" @echo off
set DIRNAME=%~dp0
java %JAVA_OPTS% -cp "%DIRNAME%\gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
