PRODUKTBILDER FÜR DIE INVENTUR  /  ẢNH SẢN PHẨM CHO INVENTUR
==============================================================

Konvention / Quy ước:
  Dateiname = Artikelnummer + ".jpg"
  Tên file  = Số Artikel + ".jpg"

Beispiele / Ví dụ:
  80024.jpg   -> Chilipulver Shichimi Togarashi
  98009.jpg   -> Chilisauce (4,5l Kanister)
  80191.jpg   -> Bambusmatte groß 27×27cm

Hinweise / Lưu ý:
  - Quadratisch ist ideal (z.B. 600×600 px), wird automatisch zugeschnitten.
    Ảnh vuông là tốt nhất (vd 600×600 px), app tự cắt cho vừa.
  - Fehlt ein Bild, zeigt die App einen neutralen Platzhalter (kein Fehler).
    Thiếu ảnh thì app hiện ô xám trống, không lỗi.
  - Bilder werden für OFFLINE-Nutzung gecacht.
    Ảnh được cache để dùng offline.

WICHTIG beim ERSETZEN eines Bildes / QUAN TRỌNG khi THAY ảnh cũ:
  Da Bilder offline gecacht werden, sieht man ein ERSETZTES Bild (gleicher
  Dateiname) evtl. weiter als altes Bild. Lösung: in sw.js die Zeile
  CACHE = 'hr-sushi-v2'  auf  'hr-sushi-v3' erhöhen -> Cache wird erneuert.

  Vì ảnh được cache offline, nếu thay ảnh mới mà GIỮ NGUYÊN tên file thì có
  thể vẫn thấy ảnh cũ. Cách xử lý: trong sw.js đổi  CACHE = 'hr-sushi-v2'
  thành 'hr-sushi-v3' -> cache được làm mới.
