# Builds pokedex-data.json for the dashboard's Pokedex tab from every player's Cobblemon Pokedex file.
# Output: player names (no UUIDs), and for each species which players have caught / only seen it.
# Deterministic: same save files -> byte-identical output, so publish.ps1 only pushes when something changed.
param(
  [string]$World = 'C:\cobblemon-server\world',
  [string]$UserCache = 'C:\cobblemon-server\usercache.json',
  [Parameter(Mandatory)][string]$OutFile
)
$ErrorActionPreference = 'Stop'

# --- Minimal NBT reader (gzip or raw, big-endian) -------------------------------------------------------
function Read-Nbt([string]$path) {
  $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
  try { $ms = New-Object IO.MemoryStream; $fs.CopyTo($ms); $bytes = $ms.ToArray() } finally { $fs.Close() }
  if ($bytes.Length -gt 1 -and $bytes[0] -eq 0x1F -and $bytes[1] -eq 0x8B) {
    $gz = New-Object IO.Compression.GZipStream((New-Object IO.MemoryStream(, $bytes)), [IO.Compression.CompressionMode]::Decompress)
    $ms = New-Object IO.MemoryStream; $gz.CopyTo($ms); $bytes = $ms.ToArray()
  }
  $script:nb = $bytes; $script:np = 0
  $t = Nbt-U8; [void](Nbt-Str); Nbt-Payload $t
}
function Nbt-U8 { $v = $script:nb[$script:np]; $script:np++; $v }
function Nbt-BE([int]$n) { $a = $script:nb[$script:np..($script:np + $n - 1)]; [array]::Reverse($a); $script:np += $n; , $a }
function Nbt-Str { $n = [BitConverter]::ToUInt16((Nbt-BE 2), 0); $s = [Text.Encoding]::UTF8.GetString($script:nb, $script:np, $n); $script:np += $n; $s }
function Nbt-Payload([int]$t) {
  switch ($t) {
    1 { return [sbyte](Nbt-U8) }
    2 { return [BitConverter]::ToInt16((Nbt-BE 2), 0) }
    3 { return [BitConverter]::ToInt32((Nbt-BE 4), 0) }
    4 { return [BitConverter]::ToInt64((Nbt-BE 8), 0) }
    5 { return [BitConverter]::ToSingle((Nbt-BE 4), 0) }
    6 { return [BitConverter]::ToDouble((Nbt-BE 8), 0) }
    7 { $n = [BitConverter]::ToInt32((Nbt-BE 4), 0); $script:np += $n; return $null }
    8 { return Nbt-Str }
    9 { $et = Nbt-U8; $n = [BitConverter]::ToInt32((Nbt-BE 4), 0); $l = New-Object System.Collections.ArrayList; for ($i = 0; $i -lt $n; $i++) { [void]$l.Add((Nbt-Payload $et)) }; return , $l.ToArray() }
    10 { $o = [ordered]@{}; while ($true) { $ct = Nbt-U8; if ($ct -eq 0) { break }; $k = Nbt-Str; $o[$k] = Nbt-Payload $ct }; return $o }
    11 { $n = [BitConverter]::ToInt32((Nbt-BE 4), 0); $script:np += 4 * $n; return $null }
    12 { $n = [BitConverter]::ToInt32((Nbt-BE 4), 0); $script:np += 8 * $n; return $null }
  }
}

# --- Names: UUID -> current username (from the server's own cache) -------------------------------------
$names = @{}
if (Test-Path $UserCache) { foreach ($u in (Get-Content $UserCache -Raw | ConvertFrom-Json)) { $names[$u.uuid.ToLower()] = $u.name } }

$records = @()
$newest = [datetime]::MinValue
foreach ($f in Get-ChildItem (Join-Path $World 'pokedex') -Recurse -Filter '*.nbt' -ErrorAction SilentlyContinue) {
  $uuid = $f.BaseName.ToLower()
  if (-not $names[$uuid]) { continue }   # unknown player: skip rather than publish an ID
  try { $d = Read-Nbt $f.FullName } catch { Write-Warning "Skipped $($f.Name): $($_.Exception.Message)"; continue }
  if ($f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc }
  $caught = @{}; $seen = @{}
  foreach ($key in $d.speciesRecords.Keys) {
    $id = ($key -split ':')[-1]
    $forms = $d.speciesRecords[$key].formRecords
    $k = @($forms.Values | ForEach-Object { $_.knowledge })
    # Cobblemon 1.8.1 records knowledge as SEEN or OWNED (CAUGHT kept in case a later version renames it).
    if ($k -contains 'OWNED' -or $k -contains 'CAUGHT') { $caught[$id] = $true } elseif ($k.Count) { $seen[$id] = $true }
  }
  if ($caught.Count -or $seen.Count) { $records += [pscustomobject]@{ name = $names[$uuid]; caught = $caught; seen = $seen } }
}

$records = @($records | Sort-Object name)
$caughtBy = @{}; $seenBy = @{}
for ($i = 0; $i -lt $records.Count; $i++) {
  foreach ($id in $records[$i].caught.Keys) { if (-not $caughtBy[$id]) { $caughtBy[$id] = @() }; $caughtBy[$id] += $i }
  foreach ($id in $records[$i].seen.Keys) { if (-not $seenBy[$id]) { $seenBy[$id] = @() }; $seenBy[$id] += $i }
}
function Sorted($h) { $o = [ordered]@{}; foreach ($k in ($h.Keys | Sort-Object)) { $o[$k] = @($h[$k] | Sort-Object) }; $o }

$out = [ordered]@{
  updated = $(if ($newest -gt [datetime]::MinValue) { $newest.ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $null })
  players = @($records | ForEach-Object { [ordered]@{ name = $_.name; caught = $_.caught.Count; seen = $_.caught.Count + $_.seen.Count } })
  caught  = Sorted $caughtBy
  seen    = Sorted $seenBy
}
[IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject $out -Compress -Depth 5), (New-Object Text.UTF8Encoding $false))
