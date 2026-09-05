# -*- coding: utf-8 -*-
"""Fuegt den bestehenden Mitarbeiter-Anleitungen (German.pdf / Huong_dan_su_dung_VI.pdf)
zwei neue Abschnitte hinzu (Urlaub "Vorschlag Gebietsleiter"-Badge, App-Updates),
im gleichen visuellen Stil wie die bestehenden Seiten (Tahoma/Tahoma-Bold, rote
Ueberschrift #c0392b, cremefarbene Tipp-Box, rote nummerierte Screenshot-Badges)."""
import fitz

RED = (0xc0/255, 0x39/255, 0x2b/255)
BODY = (0x2b/255, 0x2b/255, 0x2b/255)
TIP_BG = (1.0, 0x2b/255*0+0.9686, 0.902)
TIP_TXT = (0x8a/255, 0x6d/255, 0.0)

TAHOMA = "C:/Windows/Fonts/tahoma.ttf"
TAHOMA_BD = "C:/Windows/Fonts/tahomabd.ttf"

PAGE_W, PAGE_H = 595.2755737304688, 841.8897705078125
ML = 57.02362060546875
MR = 538.25  # rechter Textrand (aus bestehenden Seiten abgeleitet)
BODY_SIZE = 13
BODY_LEAD = 19
STEP_SIZE = 12.5
TIP_SIZE = 12
TIP_LEAD = 17

def wrap(text, fontfile, size, max_width):
    font = fitz.Font(fontfile=fontfile)
    words = text.split(' ')
    lines, cur = [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if font.text_length(trial, fontsize=size) <= max_width or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def draw_heading(page, text, y=77):
    page.insert_font(fontfile=TAHOMA_BD, fontname="TahomaBD")
    page.insert_text((ML, y), text, fontname="TahomaBD", fontsize=20, color=RED, fontfile=TAHOMA_BD)

def draw_body(page, lines, y, size=BODY_SIZE, lead=BODY_LEAD, color=BODY, bold=False):
    ff = TAHOMA_BD if bold else TAHOMA
    fn = "TahomaBD" if bold else "Tahoma"
    page.insert_font(fontfile=ff, fontname=fn)
    for i, line in enumerate(lines):
        page.insert_text((ML, y + i * lead), line, fontname=fn, fontsize=size, color=color, fontfile=ff)
    return y + len(lines) * lead

def draw_tip(page, label, text, y_top):
    lines = wrap(text, TAHOMA, TIP_SIZE, MR - ML - 8 - fitz.Font(fontfile=TAHOMA).text_length(label + ' ', fontsize=TIP_SIZE))
    # einfacher: label + Text zusammen umbrechen, Label wird im ersten Wort mitgezaehlt
    full = label + ' ' + text
    lines = wrap(full, TAHOMA, TIP_SIZE, MR - ML - 16)
    box_h = max(50, 18 + len(lines) * TIP_LEAD + 6)
    page.draw_rect(fitz.Rect(ML - 8, y_top, MR + 8, y_top + box_h), color=None, fill=TIP_BG)
    page.insert_font(fontfile=TAHOMA, fontname="Tahoma")
    for i, line in enumerate(lines):
        page.insert_text((ML, y_top + 20 + i * TIP_LEAD), line, fontname="Tahoma", fontsize=TIP_SIZE, color=TIP_TXT, fontfile=TAHOMA)
    return y_top + box_h

def place_image(page, img_path, y_top, target_w):
    pix = fitz.Pixmap(img_path)
    ratio = pix.height / pix.width
    w, h = target_w, target_w * ratio
    x = (PAGE_W - w) / 2
    page.insert_image(fitz.Rect(x, y_top, x + w, y_top + h), filename=img_path)
    return y_top + h

def build_section(doc, heading, body_lines, img_path, img_w, tip_label, tip_text, step_line=None):
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    draw_heading(page, heading)
    y = 104
    y = draw_body(page, body_lines, y)
    if step_line:
        y += 8
        y = draw_body(page, wrap(step_line, TAHOMA, STEP_SIZE, MR-ML), y, size=STEP_SIZE)
    y += 18
    y = place_image(page, img_path, y, img_w)
    y += 24
    draw_tip(page, tip_label, tip_text, y)
    return page

def add_toc_lines(doc, toc_page_index, new_entries, first_item_count):
    page = doc[toc_page_index]
    page.insert_font(fontfile=TAHOMA, fontname="Tahoma")
    # Bestehende Zeilen stehen exakt alle 22pt ab y=110 (Item 1) - Item N bei
    # y = 110 + (N-1)*22. Direkt daran anschliessen statt Text neu zu vermessen.
    y = 110 + first_item_count * 22
    for entry in new_entries:
        page.insert_text((ML, y), entry, fontname="Tahoma", fontsize=13, color=BODY, fontfile=TAHOMA)
        y += 22

GUIDE_SHOTS = "output/guide_shots"

# ─── DEUTSCH ──────────────────────────────────────────────────────
def build_german(src, dst):
    doc = fitz.open(src)
    add_toc_lines(doc, 1, [
        "13. Urlaub: \"Vorschlag Gebietsleiter\" erkennen",
        "14. App-Updates",
    ], first_item_count=12)
    build_section(
        doc,
        "13. Urlaub: \"Vorschlag Gebietsleiter\"",
        wrap("In der Urlaubsliste deiner Filiale siehst du bei jedem Eintrag, wer ihn eingetragen hat.", TAHOMA, BODY_SIZE, MR-ML) +
        wrap("Ein Eintrag mit dem blauen Hinweis \"Vorschlag Gebietsleiter\" wurde von deinem Gebietsleiter eingetragen (z.B. im Rahmen der Jahresplanung) — nicht von dir selbst beantragt. Ein Eintrag OHNE diesen Hinweis ist ein Antrag, den du oder ein Kollege selbst über \"Urlaub beantragen\" gestellt hat.", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/urlaub_gl_vorschlag_annot_de.png", 190,
        "Tipp:", "Passt ein Termin mit \"Vorschlag Gebietsleiter\" für dich nicht, sprich direkt mit deinem Gebietsleiter — bei einer Überschneidung mit einem selbst gestellten Antrag hat dein eigener Antrag immer Vorrang.",
    )
    build_section(
        doc,
        "14. App-Updates",
        wrap("Die App bekommt regelmäßig neue Funktionen und Verbesserungen. Wenn eine neue Version bereit ist, erscheint oben in der App ein blauer Balken mit dem Hinweis \"Neue Version verfügbar.\"", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/update_banner_annot_de.png", 300,
        "Tipp:", "Bist du gerade mitten in einer Eingabe (z.B. ein Urlaubsantrag), kannst du erst fertig werden und danach aktualisieren — die App zwingt dich nicht sofort. Ein Klick auf \"Jetzt aktualisieren\" lädt die neueste Version.",
        step_line="Schritt 1. Tippe auf den grünen Knopf \"Jetzt aktualisieren\", um die neueste Version zu laden.",
    )
    doc.save(dst, garbage=4, deflate=True)
    print("saved", dst, "pages:", doc.page_count)

# ─── TIẾNG VIỆT ───────────────────────────────────────────────────
def build_vi(src, dst):
    doc = fitz.open(src)
    add_toc_lines(doc, 1, [
        "13. Nhận biết nhãn \"GL đề xuất\" trên lịch nghỉ phép",
        "14. Cập nhật ứng dụng",
    ], first_item_count=12)
    build_section(
        doc,
        "13. Nhãn \"GL đề xuất\" trên lịch nghỉ",
        wrap("Trong danh sách nghỉ phép của cửa hàng, mỗi lịch nghỉ đều cho biết ai là người thêm.", TAHOMA, BODY_SIZE, MR-ML) +
        wrap("Lịch có nhãn xanh \"GL đề xuất\" nghĩa là quản lý khu vực (Gebietsleiter) đã thêm lịch này (ví dụ trong kế hoạch nghỉ phép cả năm) — không phải do bạn tự đăng ký. Lịch KHÔNG có nhãn này là do chính bạn hoặc đồng nghiệp tự gửi qua \"Đăng ký nghỉ phép\".", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/urlaub_gl_vorschlag_annot_vi.png", 190,
        "Mẹo:", "Nếu lịch \"GL đề xuất\" không phù hợp với bạn, hãy trao đổi trực tiếp với quản lý khu vực — khi trùng lịch, lịch bạn tự đăng ký luôn được ưu tiên giữ nguyên, không bị dời.",
    )
    build_section(
        doc,
        "14. Cập nhật ứng dụng",
        wrap("Ứng dụng thường xuyên được bổ sung chức năng mới và cải tiến. Khi có phiên bản mới, một thanh màu xanh dương hiện ở đầu ứng dụng với dòng chữ \"Có phiên bản mới.\"", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/update_banner_annot_vi.png", 300,
        "Mẹo:", "Nếu bạn đang nhập dở dữ liệu (ví dụ đang điền đơn xin nghỉ phép), cứ hoàn thành trước rồi cập nhật sau — ứng dụng không bắt bạn cập nhật ngay lập tức. Bấm \"Cập nhật ngay\" để tải phiên bản mới nhất.",
        step_line="Bước 1. Bấm nút xanh lá \"Cập nhật ngay\" để tải phiên bản mới nhất.",
    )
    doc.save(dst, garbage=4, deflate=True)
    print("saved", dst, "pages:", doc.page_count)

if __name__ == "__main__":
    build_german(
        r"C:\Users\DoungDucThang\OneDrive - Wonderfield Group\Desktop\German.pdf",
        "output/German_updated.pdf",
    )
    build_vi(
        r"C:\Users\DoungDucThang\OneDrive - Wonderfield Group\Desktop\Huong_dan_su_dung_VI.pdf",
        "output/Huong_dan_su_dung_VI_updated.pdf",
    )
