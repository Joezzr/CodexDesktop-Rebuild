function DirSizes($roots, $minMB) {
  foreach ($r in $roots) {
    if (!(Test-Path $r)) { continue }
    $items = Get-ChildItem -Path $r -Directory -Force -ErrorAction SilentlyContinue
    foreach ($it in $items) {
      $b = (Get-ChildItem -Path $it.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      $mb = [math]::Round($b/1MB,0)
      if ($mb -ge $minMB) { Write-Output ("{0,8} MB  {1}" -f $mb, $it.FullName) }
    }
  }
}
Write-Output "== Temp 下 >500MB 目录 =="
DirSizes @("$env:TEMP") 500
Write-Output ""
Write-Output "== cargo 缓存构成 =="
DirSizes @("C:\Users\Kal\AppData\Local\CodexDesktop-Rebuild\cargo-target") 1000