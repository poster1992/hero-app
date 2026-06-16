@echo off
title FLOORTEC Dashboard
set "PATH=%PATH%;C:\Program Files\nodejs"
cd /d "C:\Users\PascalOsterFLOORTEC\hero-app"

rem LAN-IP ermitteln (fuer Zugriff vom iPad im selben WLAN)
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LANIP=%%i"

echo Starte FLOORTEC Dashboard...
echo.
echo   Auf diesem PC:        http://localhost:3000
echo   Auf dem iPad (WLAN):  http://%LANIP%:3000
echo.
echo Beide Geraete muessen im selben WLAN sein.
echo Fenster offen lassen. Zum Beenden: Strg + C
echo.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
npm run dev
pause
