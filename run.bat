@echo off
rem Convenience launcher for the published CLI.
rem  1. ensure-fresh.ps1 republishes artifacts\MindAttic.Deploy.exe iff sources changed
rem  2. exec the published single-file exe with whatever args the caller passed

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-fresh.ps1"
if errorlevel 1 exit /b %errorlevel%

"%~dp0artifacts\MindAttic.Deploy.exe" %*
