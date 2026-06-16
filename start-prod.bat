@echo off
title FLOORTEC Dashboard (schnell / Produktion)
set "PATH=%PATH%;C:\Program Files\nodejs"
cd /d "C:\Users\PascalOsterFLOORTEC\hero-app"

rem LAN-IP ermitteln (fuer Zugriff vom iPad im selben WLAN)
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LANIP=%%i"

echo ============================================================
echo  FLOORTEC Dashboard - Produktionsmodus (schnell)
echo ============================================================
echo  Schritt 1/2: Build wird erstellt (dauert 1-2 Minuten) ...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo BUILD FEHLGESCHLAGEN. Bitte Meldung oben pruefen.
  pause
  exit /b 1
)

echo.
echo  Beende evtl. laufenden Server auf Port 3000 ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo  Schritt 2/2: Server startet ...
echo.
echo   Auf diesem PC:        http://localhost:3000
echo   Auf dem iPad (WLAN):  http://%LANIP%:3000
echo.
echo  Fenster offen lassen. Zum Beenden: Strg + C
echo.
call npm run start
pause
