@echo off
setlocal
title KutumbLink - Local Server
cd /d "%~dp0"

echo ============================================
echo   KUTUMBLINK - Local Application Launcher
echo ============================================
echo.

if not exist "package.json" goto NO_PROJECT

where node >nul 2>nul
if errorlevel 1 goto NO_NODE
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 goto OLD_NODE
echo Using Node.js %NODE_MAJOR%+
echo.

if not exist ".env" goto CREATE_ENV
goto CHECK_ENV

:CREATE_ENV
if not exist ".env.example" goto NO_ENV_TEMPLATE
copy /y ".env.example" ".env" >nul
echo [SETUP] Created .env from .env.example.
goto NEED_ENV

:CHECK_ENV
echo Checking settings in: %cd%\.env
set "ENV_NEEDS_SETUP="
findstr /i /c:"DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB" .env >nul
if not errorlevel 1 (
  echo   - DATABASE_URL is still the sample value.
  set "ENV_NEEDS_SETUP=1"
)
findstr /i /c:"ADMIN_PASSWORD=ChangeThisToARandomPassword" .env >nul
if not errorlevel 1 (
  echo   - ADMIN_PASSWORD is still the sample value.
  set "ENV_NEEDS_SETUP=1"
)
findstr /i /c:"JWT_SECRET=ReplaceWithARandomSecret" .env >nul
if not errorlevel 1 (
  echo   - JWT_SECRET is still the sample value.
  set "ENV_NEEDS_SETUP=1"
)
findstr /i /c:"ENCRYPTION_KEY=ReplaceWithAnotherRandomSecret" .env >nul
if not errorlevel 1 (
  echo   - ENCRYPTION_KEY is still the sample value.
  set "ENV_NEEDS_SETUP=1"
)
if defined ENV_NEEDS_SETUP goto NEED_ENV
goto HAVE_ENV

:NEED_ENV
echo.
echo [SETUP REQUIRED] Replace the sample values listed above in this .env file.
echo   Edit the existing lines; don't add duplicate settings below them.
echo   Keep this .env beside app.cmd and package.json.
echo.
echo Save .env, then double-click app.cmd again.
goto FAIL

:HAVE_ENV
if not exist "node_modules" goto INSTALL
if /i "%1"=="install" goto INSTALL
echo Dependencies are already installed. Use "app.cmd install" to reinstall.
goto AFTER_INSTALL

:INSTALL
echo [SETUP] Installing dependencies from package-lock.json...
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto INSTALL_FAILED

:AFTER_INSTALL
echo.
echo [SETUP] Applying the database schema and importing initial data if needed...
call node server\db\migrate.js
if errorlevel 1 goto MIGRATE_FAILED

if not exist "dist\index.html" goto BUILD
if /i "%1"=="rebuild" goto BUILD
node scripts\verify-dist.js
if errorlevel 1 goto BUILD
echo Existing production build is complete. Use "app.cmd rebuild" to rebuild it anyway.
goto AFTER_BUILD

:BUILD
echo.
echo [BUILD] Creating the production frontend...
call npm run build
if errorlevel 1 goto BUILD_FAILED

:AFTER_BUILD
if "%PORT%"=="" set "PORT=8080"
set "REQUESTED_PORT=%PORT%"
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\find-free-port.ps1" -StartPort %REQUESTED_PORT%`) do set "PORT=%%P"
if "%PORT%"=="" goto NO_FREE_PORT
if not "%PORT%"=="%REQUESTED_PORT%" echo [INFO] Port %REQUESTED_PORT% is already in use; starting this package on port %PORT% instead.
echo.
echo ============================================
echo   Starting KutumbLink at http://localhost:%PORT%
echo   A browser will open automatically when the server is ready.
echo   Press Ctrl+C in this window to stop it.
echo ============================================
echo.
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "for ($i = 0; $i -lt 180; $i++) { try { Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/ping' -TimeoutSec 2 -UseBasicParsing | Out-Null; try { Start-Process -FilePath 'http://localhost:%PORT%/' } catch { Start-Process -FilePath (Join-Path $env:WINDIR 'System32\rundll32.exe') -ArgumentList 'url.dll,FileProtocolHandler http://localhost:%PORT%/' }; exit 0 } catch { Start-Sleep -Seconds 1 } }"
call npm start
if errorlevel 1 goto SERVER_FAILED
goto END

:NO_PROJECT
echo [ERROR] package.json was not found. Extract the complete ZIP first,
echo then run app.cmd from inside the Kutumb-main folder.
goto FAIL

:NO_NODE
echo [ERROR] Node.js was not found. Install Node.js 18 or later from https://nodejs.org
goto FAIL

:OLD_NODE
echo [ERROR] Node.js 18 or later is required. Current major version: %NODE_MAJOR%.
goto FAIL

:NO_ENV_TEMPLATE
echo [ERROR] .env and .env.example are both missing from this package.
goto FAIL

:INSTALL_FAILED
echo [ERROR] Dependency installation failed. Check your internet connection and try again.
goto FAIL

:MIGRATE_FAILED
echo [ERROR] Database setup failed. Check DATABASE_URL and PostgreSQL access in .env.
echo Read the detailed PostgreSQL error above. If it says "permission denied for schema public",
echo the database user needs CREATE and USAGE permission on the public schema.
goto FAIL

:BUILD_FAILED
echo [ERROR] Frontend build failed. Review the messages above.
goto FAIL

:SERVER_FAILED
echo [ERROR] KutumbLink stopped because the server exited with an error.
echo The server error is shown above. Take a screenshot or copy the last 30 lines before closing.
goto FAIL

:NO_FREE_PORT
echo [ERROR] No free port was found between the selected port and port 8199.
echo Close the other local server or set PORT to a free port, then run app.cmd again.
goto FAIL

:FAIL
echo.
pause

:END
endlocal
