# Builds the dashboard + a BlueMap snapshot and force-pushes it as a single commit to gh-pages.
# Skips the push when nothing changed. Run by the hourly scheduled task; safe to run by hand.
param([switch]$Force, [string]$MapsDir = 'C:\cobblemon-server\bluemap\web\maps')

$ErrorActionPreference = 'Stop'
$site    = Split-Path $PSScriptRoot -Parent
$blueWeb = 'C:\cobblemon-server\bluemap\web'
$pub     = Join-Path $site '.publish'
$stage   = Join-Path $env:TEMP 'cobblemon-pages-stage'
$logFile = Join-Path $site 'publish.log'
$remote  = 'https://github.com/charles28lc/cobblemon-dashboard.git'

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) {
  $git = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter git.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'Git\.MinGit.*\\cmd\\git\.exe$' } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $git) { throw 'git not found' }

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content $logFile $line
  Write-Output $line
  $all = Get-Content $logFile
  if ($all.Count -gt 300) { $all | Select-Object -Last 300 | Set-Content $logFile }
}

function Git { & $git -C $pub @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed ($LASTEXITCODE)" } }

function Mirror($from, $to, [string[]]$excludeDirs = @()) {
  $opts = @('/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($excludeDirs) { $opts += '/XD'; $opts += $excludeDirs }
  & robocopy $from $to @opts | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $from -> $to failed ($LASTEXITCODE)" }
}

try {
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory $stage | Out-Null

  foreach ($f in 'index.html', 'commands.html', 'style.css', 'app.js', 'favicon.svg') { Copy-Item (Join-Path $site $f) $stage }

  # GitHub Pages lets browsers reuse files for 10 min; fingerprint CSS/JS links so new HTML never pairs with old CSS.
  $ver = @{}
  foreach ($a in 'style.css', 'app.js') { $ver[$a] = (Get-FileHash (Join-Path $stage $a) -Algorithm SHA256).Hash.Substring(0, 10).ToLower() }
  foreach ($page in 'index.html', 'commands.html') {
    $p = Join-Path $stage $page
    $html = [IO.File]::ReadAllText($p)
    foreach ($a in $ver.Keys) { $html = $html.Replace("=`"$a`"", "=`"$a`?v=$($ver[$a])`"") }
    [IO.File]::WriteAllText($p, $html)
  }
  New-Item -ItemType File (Join-Path $stage '.nojekyll') | Out-Null

  $mapsSrc = $MapsDir
  $maps = @()
  if (Test-Path $mapsSrc) {
    $order = (Get-Content (Join-Path $blueWeb 'settings.json') -Raw | ConvertFrom-Json).maps
    $maps = @($order | Where-Object {
      (Test-Path (Join-Path $mapsSrc "$_\settings.json")) -and
      (Get-ChildItem (Join-Path $mapsSrc "$_\tiles") -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)
    })
  }

  $info = [ordered]@{ available = $false }
  if ($maps.Count -gt 0) {
    $mapOut = Join-Path $stage 'map'
    Mirror (Join-Path $blueWeb 'assets') (Join-Path $mapOut 'assets')
    Mirror (Join-Path $blueWeb 'lang') (Join-Path $mapOut 'lang')
    Copy-Item (Join-Path $PSScriptRoot 'map-sw.js') (Join-Path $mapOut 'sw.js')

    $settings = Get-Content (Join-Path $blueWeb 'settings.json') -Raw | ConvertFrom-Json
    $settings.maps = $maps
    ($settings | ConvertTo-Json -Compress -Depth 10) | Set-Content (Join-Path $mapOut 'settings.json') -Encoding utf8

    $html = Get-Content (Join-Path $blueWeb 'index.html') -Raw
    $m = [regex]::Match($html, '<script type="module" crossorigin src="(\./assets/index-[^"]+\.js)"></script>')
    if (-not $m.Success) { throw 'BlueMap index.html layout changed: module script tag not found' }
    $loader = @"
<script>
(async () => {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("./sw.js");
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    }
  }
  const s = document.createElement("script");
  s.type = "module";
  s.src = "$($m.Groups[1].Value)";
  document.head.append(s);
})();
</script>
"@
    $html.Replace($m.Value, $loader) | Set-Content (Join-Path $mapOut 'index.html') -Encoding utf8

    $newest = [datetime]::MinValue
    foreach ($id in $maps) {
      $dst = Join-Path $mapOut "maps\$id"
      Mirror (Join-Path $mapsSrc $id) $dst @('rstate')
      $live = Join-Path $dst 'live'
      New-Item -ItemType Directory -Force $live | Out-Null
      '{"players":[]}' | Set-Content (Join-Path $live 'players.json') -Encoding ascii -NoNewline
      $t = (Get-ChildItem (Join-Path $dst 'tiles') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum
      if ($t -and $t -gt $newest) { $newest = $t }
    }
    $info.available = $true
    if ($newest -gt [datetime]::MinValue) { $info.updated = $newest.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
  }
  ($info | ConvertTo-Json -Compress) | Set-Content (Join-Path $stage 'map-info.json') -Encoding ascii -NoNewline

  if (-not (Test-Path (Join-Path $pub '.git'))) {
    New-Item -ItemType Directory -Force $pub | Out-Null
    & $git init -q -b gh-pages $pub
    Git config user.name 'charles28lc'
    Git config user.email '139080546+charles28lc@users.noreply.github.com'
    Git config core.autocrlf false
    Git remote add origin $remote
  }

  Mirror $stage $pub @('.git')

  Git add -A
  $changes = & $git -C $pub status --porcelain
  $hasHead = (& $git -C $pub rev-parse --verify -q HEAD) -ne $null
  if (-not $changes -and $hasHead -and -not $Force) { Log 'No changes; skipped.'; exit 0 }

  $msg = "Publish $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  if ($hasHead) { Git commit -q --amend -m $msg } else { Git commit -q -m $msg }
  Git push -q --force origin gh-pages
  Git reflog expire --expire=now --all
  Git gc -q --prune=now

  $mb = [math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
  Log "Published: maps=[$($maps -join ', ')] size=${mb}MB"
}
catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
