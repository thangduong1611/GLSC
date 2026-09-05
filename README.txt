HR-APP GLSC — HINWEISE & NEUE FUNKTIONEN
==============================================================
HR-APP GLSC — HƯỚNG DẪN & CÁC CHỨC NĂNG MỚI
==============================================================


PRODUKTBILDER FÜR DIE INVENTUR  /  ẢNH SẢN PHẨM CHO INVENTUR
--------------------------------------------------------------

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
  CACHE = 'hr-sushi-v6'  hochzählen (z.B. 'hr-sushi-v7') -> Cache wird erneuert.

  Vì ảnh được cache offline, nếu thay ảnh mới mà GIỮ NGUYÊN tên file thì có
  thể vẫn thấy ảnh cũ. Cách xử lý: trong sw.js đổi  CACHE = 'hr-sushi-v6'
  lên số mới (vd 'hr-sushi-v7') -> cache được làm mới.


URLAUB: KENNZEICHNUNG "VORSCHLAG GEBIETSLEITER"  (Stand: 04.09.2026)
--------------------------------------------------------------
NHÃN "GL ĐỀ XUẤT" TRÊN LỊCH NGHỈ  (Cập nhật: 04.09.2026)
--------------------------------------------------------------

DE: In der Mitarbeiter-App (mitarbeiter.html, Reiter "Urlaub") ist jeder
Eintrag, den der Gebietsleiter selbst eingetragen hat (automatischer
Jahresplan oder manuelle Eingabe über die Admin-App), jetzt mit dem Hinweis
"Vorschlag Gebietsleiter" gekennzeichnet. Ein Eintrag OHNE diesen Hinweis
wurde vom Mitarbeiter selbst beantragt. Ziel: Transparenz, damit kein
Mitarbeiter denkt, ihm sei ohne sein Wissen etwas "untergeschoben" worden.
Bei einer Terminüberschneidung hat ein selbst eingereichter Antrag immer
Vorrang — nur die automatisch erzeugten Einträge werden bei Bedarf verschoben.

VI: Trong app nhân viên (mitarbeiter.html, tab "Urlaub"), mọi lịch nghỉ do
Gebietsleiter tự thêm (kế hoạch năm tự động hoặc thêm tay qua app quản lý)
giờ hiển thị nhãn "GL đề xuất". Lịch KHÔNG có nhãn này là do chính nhân viên
tự đăng ký. Mục đích: minh bạch, tránh việc nhân viên nghĩ rằng ai đó tự ý
thêm lịch cho họ mà họ không biết. Khi có trùng lịch, lịch nhân viên tự đăng
ký luôn được ưu tiên giữ nguyên — chỉ những lịch tự động mới bị dời khi cần.


APP-UPDATES: SCHNELLERE AKTUALISIERUNG  (Stand: 04.09.2026)
--------------------------------------------------------------
APP CẬP NHẬT NHANH HƠN  (Cập nhật: 04.09.2026)
--------------------------------------------------------------

DE: Bisher musste die App teils mehrfach geschlossen und neu geöffnet werden,
bis eine neue Version (nach einem Update durch den Gebietsleiter) sichtbar
wurde. Jetzt prüft die App aktiv im Hintergrund auf eine neue Version — beim
erneuten Öffnen und alle 5 Minuten, solange sie offen bleibt. Wird eine neue
Version gefunden, erscheint oben ein blauer Balken "🔄 Neue Version
verfügbar" mit einem Knopf "Jetzt aktualisieren". Ein Klick lädt die Seite
neu; laufende Eingaben werden dabei NICHT automatisch abgebrochen, der
Mitarbeiter entscheidet selbst, wann er aktualisiert.

VI: Trước đây nhiều khi phải tắt/mở app vài lần mới thấy bản cập nhật mới
(sau khi Gebietsleiter thay đổi gì đó). Giờ app tự động kiểm tra phiên bản
mới ở nền — mỗi khi mở lại app và cứ mỗi 5 phút trong lúc app đang mở. Nếu
có bản mới, một thanh màu xanh "🔄 Có phiên bản mới" hiện ở đầu trang kèm nút
"Cập nhật ngay". Nhấn vào sẽ tải lại trang; app KHÔNG tự tải lại một mình để
tránh làm gián đoạn khi nhân viên đang nhập liệu — nhân viên tự quyết định
lúc nào bấm cập nhật.


GESAMTÜBERSICHT: MONAT WÄHLEN + BESSER LESBARER AUSDRUCK  (Stand: 05.09.2026)
--------------------------------------------------------------
GESAMTÜBERSICHT: CHỌN THÁNG + BẢN IN RÕ RÀNG HƠN  (Cập nhật: 05.09.2026)
--------------------------------------------------------------

DE: Im Admin-Bereich (index.html, Reiter "Dienstplan" -> Karte
"Gesamtübersicht") war der Export bisher fest auf "aktueller + nächster
Monat" begrenzt. Jetzt erscheint eine Reihe von Monats-Buttons (2 Monate
zurück bis 11 Monate voraus) — beliebig viele Monate anklicken, dann PDF
oder CSV (Excel) exportieren. Zusätzlich wurde das PDF-Layout überarbeitet:
statt den ganzen Monat (28-31 Tage) in eine einzige, sehr schmale Tabelle zu
quetschen, wird jeder Monat je Filiale in zwei Halbmonats-Blöcke aufgeteilt
(z.B. Tag 1-15 und 16-30). Dadurch sind die Tagesspalten etwa doppelt so
breit und die Schrift größer — beim Ausdrucken deutlich klarer lesbar.

VI: Trong khu vực quản lý (index.html, tab "Dienstplan" -> thẻ
"Gesamtübersicht"), trước đây file xuất ra luôn cố định "tháng hiện tại +
tháng sau" không đổi được. Giờ có một dãy nút chọn tháng (từ 2 tháng trước
đến 11 tháng sau) — chọn bao nhiêu tháng tùy ý rồi xuất PDF hoặc CSV
(Excel). Ngoài ra, cách trình bày PDF cũng được làm lại: thay vì nhồi cả
tháng (28-31 ngày) vào một bảng rất hẹp, mỗi tháng của mỗi tiệm giờ được
chia thành 2 nửa tháng (vd ngày 1-15 và 16-30). Nhờ vậy các cột ngày rộng
gấp đôi, chữ cũng to hơn — in ra đọc rõ ràng hơn hẳn.
