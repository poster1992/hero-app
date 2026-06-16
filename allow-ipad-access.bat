@echo off
title FLOORTEC - Zugriff im WLAN freigeben
rem Einmalig ausfuehren: WLAN auf "Privat" setzen und Port 3000 im Netzwerk freigeben.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Hole Administrator-Rechte ...
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo Setze WLAN-Profil auf "Privat" ...
powershell -NoProfile -Command "Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like 'WLAN*' -or $_.InterfaceAlias -like 'Wi-Fi*' -or $_.InterfaceAlias -like 'WiFi*' } | Set-NetConnectionProfile -NetworkCategory Private"

echo Lege Firewall-Freigabe fuer Port 3000 an (alle Profile) ...
netsh advfirewall firewall delete rule name="FLOORTEC Dashboard 3000" >nul 2>&1
netsh advfirewall firewall add rule name="FLOORTEC Dashboard 3000" dir=in action=allow protocol=TCP localport=3000 profile=any

for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LANIP=%%i"

echo.
echo Fertig. Andere Geraete im WLAN koennen die Seite jetzt oeffnen.
echo Auf dem iPad: http://%LANIP%:3000
echo.
pause
