# -*- coding: utf-8 -*-
"""Fuegt 2 weitere Abschnitte hinzu (Auftrag t.duong 05.09.2026): "Meine Daten
(Welo)" ansehen (Urlaub-Reiter) und Umsatzziel der Filiale ansehen
(Dienstplan-Reiter) - beide Funktionen existieren bereits in der App, fehlten
aber in der Anleitung. Baut auf update_guides.py auf (gleiche Helfer/Stil)."""
import fitz
from update_guides import (
    wrap, draw_heading, draw_body, draw_tip, place_image, build_section,
    add_toc_lines, TAHOMA, BODY_SIZE, MR, ML, GUIDE_SHOTS,
)

def build_german(src, dst):
    doc = fitz.open(src)
    add_toc_lines(doc, 1, [
        "15. \"Meine Daten (Welo)\" ansehen",
        "16. Umsatzziel der Filiale ansehen",
    ], first_item_count=14)
    build_section(
        doc,
        "15. \"Meine Daten (Welo)\" ansehen",
        wrap("Im Urlaub-Bereich siehst du oben deine eigenen Kennzahlen aus Welo: wie viele Stunden du pro Woche vertraglich arbeitest, wie viele Urlaubstage dir noch zustehen und wie viele Krankheitstage du dieses Jahr hattest.", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/welo_self_de.png", 260,
        "Tipp:", "Diese Zahlen werden einmal täglich aus Welo aktualisiert (siehe \"Stand: ...\" unten in der Karte) — für den exakt aktuellen Stand frag im Zweifel deinen Gebietsleiter.",
        step_line="Schritt 1. Tippe im Hauptmenü auf das Symbol Urlaub — die Karte \"Meine Daten (Welo)\" erscheint ganz oben.",
    )
    build_section(
        doc,
        "16. Umsatzziel der Filiale ansehen",
        wrap("Unter deinem Dienstplan siehst du das heutige Umsatzziel deiner Filiale — mit dem Vorjahreswert zum Vergleich, dem bereits erreichten Umsatz und wie viel dafür noch produziert werden muss.", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/ziel_info_de.png", 340,
        "Tipp:", "Der Balken zeigt den Fortschritt zum Tagesziel — grün, sobald es erreicht ist. Erscheint für deine Filiale (noch) kein Ziel, liegt für heute einfach noch kein Vorjahreswert vor.",
        step_line="Schritt 1. Tippe im Hauptmenü auf das Symbol Dienstplan und scrolle unter deine Schichten.",
    )
    doc.save(dst, garbage=4, deflate=True)
    print("saved", dst, "pages:", doc.page_count)

def build_vi(src, dst):
    doc = fitz.open(src)
    add_toc_lines(doc, 1, [
        "15. Xem \"Dữ liệu của tôi (Welo)\"",
        "16. Xem mục tiêu doanh số hôm nay",
    ], first_item_count=14)
    build_section(
        doc,
        "15. Xem \"Dữ liệu của tôi (Welo)\"",
        wrap("Trong mục Nghỉ phép, ở đầu trang bạn sẽ thấy các số liệu cá nhân lấy từ Welo: số giờ làm theo hợp đồng mỗi tuần, số ngày nghỉ phép còn lại, và số ngày ốm trong năm nay.", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/welo_self_vi.png", 260,
        "Mẹo:", "Số liệu này được Welo cập nhật mỗi ngày 1 lần (xem dòng \"Cập nhật: ...\" ở cuối thẻ) — nếu cần số chính xác nhất, hỏi trực tiếp quản lý khu vực.",
        step_line="Bước 1. Từ Menu chính, chạm vào biểu tượng Nghỉ phép — thẻ \"Dữ liệu của tôi (Welo)\" hiện ngay ở đầu trang.",
    )
    build_section(
        doc,
        "16. Mục tiêu doanh số hôm nay",
        wrap("Bên dưới lịch làm việc, bạn sẽ thấy mục tiêu doanh số hôm nay của cửa hàng — so với cùng kỳ năm trước, doanh số đã đạt được, và cần sản xuất bao nhiêu để đạt mục tiêu.", TAHOMA, BODY_SIZE, MR-ML),
        f"{GUIDE_SHOTS}/ziel_info_vi.png", 340,
        "Mẹo:", "Thanh tiến độ hiển thị % đã đạt so với mục tiêu — chuyển xanh khi đạt đủ. Nếu cửa hàng bạn chưa thấy mục tiêu hiện ra, có thể do chưa có số liệu năm trước để so sánh.",
        step_line="Bước 1. Từ Menu chính, chạm vào biểu tượng Lịch làm rồi cuộn xuống dưới phần ca làm của bạn.",
    )
    doc.save(dst, garbage=4, deflate=True)
    print("saved", dst, "pages:", doc.page_count)

if __name__ == "__main__":
    build_german(
        r"C:\Users\DoungDucThang\OneDrive - Wonderfield Group\Desktop\German.pdf",
        "output/German_updated2.pdf",
    )
    build_vi(
        r"C:\Users\DoungDucThang\OneDrive - Wonderfield Group\Desktop\Huong_dan_su_dung_VI.pdf",
        "output/Huong_dan_su_dung_VI_updated2.pdf",
    )
