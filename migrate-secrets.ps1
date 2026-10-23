$secrets = @(
  "AXONITY_PASSWORD","AXONITY_USER","SYNC_SHARED_SECRET","WELO_STATISTIK_URL",
  "hoang-AXONITY_PASSWORD","hoang-AXONITY_USER","hoang-GEBIETSLEITER_NAME","hoang-KOSTENSTELLEN","hoang-WELO_PASSWORD","hoang-WELO_STATISTIK_URL","hoang-WELO_USER",
  "ostwest-AXONITY_PASSWORD","ostwest-AXONITY_USER","ostwest-SCHWAN_PASSWORD","ostwest-SCHWAN_USER","ostwest-SKOVIK_PASSWORD","ostwest-SKOVIK_USER","ostwest-WELO_PASSWORD","ostwest-WELO_STATISTIK_URL","ostwest-WELO_USER"
)

$ok = @()
$failed = @()

foreach ($name in $secrets) {
  Write-Host ""
  Write-Host "=== $name ===" -ForegroundColor Cyan
  $secure = Read-Host "Aktuellen Wert eingeben (Eingabe bleibt unsichtbar)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ([string]::IsNullOrEmpty($plain)) {
    Write-Host "Leer eingegeben - $name wird uebersprungen." -ForegroundColor Yellow
    continue
  }
  $tmpFile = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmpFile, $plain, [System.Text.Encoding]::UTF8)
    gcloud.cmd secrets delete $name --quiet
    gcloud.cmd secrets create $name --replication-policy=user-managed --locations=europe-west3
    gcloud.cmd secrets versions add $name --data-file=$tmpFile
    Write-Host "OK: $name jetzt single-region (europe-west3)" -ForegroundColor Green
    $ok += $name
  } catch {
    Write-Host "FEHLER bei $name : $($_.Exception.Message)" -ForegroundColor Red
    $failed += $name
  } finally {
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
    $plain = $null
  }
}

Write-Host ""
Write-Host "=== Fertig ==="
Write-Host ("Erfolgreich: " + $ok.Count + " / " + $secrets.Count)
if ($failed.Count -gt 0) {
  Write-Host ("Fehlgeschlagen: " + ($failed -join ", ")) -ForegroundColor Red
}