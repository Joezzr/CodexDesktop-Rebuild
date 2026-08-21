$dirs = @(
  "C:\Windows", "C:\Program Files", "C:\Program Files (x86)",
  "C:\Users\Kal", "C:\ProgramData",
  "D:\CodexCode"
)
foreach ($d in $dirs) {
  if (Test-Path $d) {
    $bytes = (Get-ChildItem -Path $d -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $gb = [math]::Round($bytes / 1GB, 1)
    Write-Output ("{0,7} GB  {1}" -f $gb, $d)
  }
}
Write-Output "---- 系统大文件 ----"
Get-ChildItem C:\ -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -gt 200MB } |
  Select-Object Name, @{N='GB';E={[math]::Round($_.Length/1GB,2)}} | Format-Table -AutoSize