@echo off
title Lynxora App Server
echo Starting Lynxora App Server...
powershell -NoProfile -Command "
$port = 7000
$root = '%~dp0'.TrimEnd('\')
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:'+$port+'/')
$listener.Start()
Write-Host 'Lynxora running at http://localhost:'+$port -ForegroundColor Cyan
Start-Process ('http://localhost:'+$port)
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $path = $req.Url.LocalPath.TrimStart('/')
  if ($path -eq '' -or $path -eq '/') { $path = 'index.html' }
  $file = Join-Path $root $path
  if (Test-Path $file -PathType Leaf) {
    $ext = [System.IO.Path]::GetExtension($file)
    $mime = switch ($ext) {
      '.html' { 'text/html; charset=utf-8' }
      '.js'   { 'application/javascript; charset=utf-8' }
      '.css'  { 'text/css; charset=utf-8' }
      '.png'  { 'image/png' }
      '.json' { 'application/json; charset=utf-8' }
      '.ico'  { 'image/x-icon' }
      default { 'application/octet-stream' }
    }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $res.ContentType = $mime
    $res.ContentLength64 = $bytes.Length
    $res.Headers.Add('Cache-Control','no-cache')
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $res.StatusCode = 404
  }
  $res.Close()
}
"