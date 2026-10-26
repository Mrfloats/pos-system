@echo off
rem Floatly online from this computer, through Cloudflare.
rem
rem   floatly start              build (if needed) and start everything, then show the address
rem   floatly address            show the address people use
rem   floatly stop               stop it (data is kept)
rem   floatly status             what's running
rem   floatly logs [service]     follow the logs (api, web, caddy, cloudflared...)
rem   floatly admin EMAIL PASSWORD "Your Name"   create your Floatly admin login
rem   floatly backups            list the nightly backups
rem
rem Two modes, chosen from .env.production:
rem   - TUNNEL_TOKEN empty: a FREE temporary address (https://...trycloudflare.com)
rem     that changes every time Floatly restarts. No domain needed.
rem   - TUNNEL_TOKEN and DOMAIN set: your own domain, always the same address.
rem See DEPLOY.md, option B.

setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\Docker\Docker\resources\bin;%PATH%"

if not exist .env.production (
  echo .env.production is missing. Copy .env.production.example and fill it in.
  exit /b 1
)

findstr /r /c:"^TUNNEL_TOKEN=..*" .env.production >nul && (set "MODE=domain") || (set "MODE=free")
if "%MODE%"=="domain" (
  findstr /r /c:"^DOMAIN=..*" .env.production >nul || (echo TUNNEL_TOKEN is set, so set DOMAIN in .env.production too. & exit /b 1)
  set "DC=docker compose -p floatly -f docker-compose.prod.yml -f docker-compose.tunnel.yml --env-file .env.production"
) else (
  set "DC=docker compose -p floatly -f docker-compose.prod.yml -f docker-compose.quick.yml --env-file .env.production"
)

if "%1"=="start" (
  %DC% up -d --build || exit /b 1
  echo.
  call :address
  exit /b
)
if "%1"=="address" ( call :address & exit /b )
if "%1"=="stop" ( %DC% stop & exit /b )
if "%1"=="status" ( %DC% ps & exit /b )
if "%1"=="logs" ( %DC% logs -f --tail 100 %2 & exit /b )
if "%1"=="admin" ( %DC% exec api node dist/db/platform-admin.js %2 %3 %4 & exit /b )
if "%1"=="backups" ( %DC% exec backup ls -lh /backups & exit /b )

echo Usage: floatly start ^| address ^| stop ^| status ^| logs [service] ^| admin EMAIL PASSWORD "Name" ^| backups
exit /b 1

:address
if "%MODE%"=="domain" (
  for /f "tokens=2 delims==" %%d in ('findstr /r /c:"^DOMAIN=" .env.production') do echo Floatly: https://%%d
  echo On this computer also: http://localhost:8080
  exit /b
)
rem The free address appears in the tunnel's log a few seconds after it starts.
set "URL="
for /l %%i in (1,1,30) do (
  if not defined URL (
    for /f "delims=" %%u in ('powershell -NoProfile -Command "$m = docker logs floatly-cloudflared-1 2>&1 | Select-String -Pattern 'https://[a-z0-9-]+[.]trycloudflare[.]com' | Select-Object -Last 1; if ($m) { $m.Matches[0].Value }"') do set "URL=%%u"
    if not defined URL ping -n 3 127.0.0.1 >nul
  )
)
if defined URL (
  echo Floatly is online at:  %URL%
  echo This free address changes every time Floatly restarts. Run "floatly address" to see the current one.
) else (
  echo The address isn't ready yet. Wait a moment and run: floatly address
)
echo On this computer also: http://localhost:8080
exit /b
