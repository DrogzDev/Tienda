import io
from decimal import Decimal
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


def render_sale_pdf(sale, *, currency: str = "USD") -> bytes:
    """
    Factura estilo Venezuela con campos tipo SENIAT (plantilla).

    Cambios aplicados:
    - Usa los nuevos campos del Sale: customer_name/address/id_doc/phone, payment_method/payment_reference.
    - IVA / Base imponible ahora salen de lo congelado en Sale: subtotal_bs (BASE), vat_bs (IVA), total (TOTAL Bs).
    - Si la impresión es USD: convierte BASE/IVA/TOTAL desde Bs a USD usando fx_usd, para mantener moneda única.
    - Forma de pago: marca la opción seleccionada y muestra referencia si es Pago móvil.
    """

    cur = (currency or "USD").upper()
    if cur not in ("USD", "VES"):
        cur = "USD"

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # ----------------------------
    # Helpers
    # ----------------------------
    def sget(obj, attr, default=""):
        val = getattr(obj, attr, default)
        return "" if val is None else str(val)

    def money(x) -> str:
        try:
            return f"{Decimal(x):.2f}"
        except Exception:
            return ""

    def line(x1, y1, x2, y2, w=0.8):
        c.setLineWidth(w)
        c.line(x1, y1, x2, y2)

    def rect(x, y, w, h, lw=0.8):
        c.setLineWidth(lw)
        c.rect(x, y, w, h, stroke=1, fill=0)

    def check(flag: bool) -> str:
        return "X" if flag else " "

    def to_usd(bs: Decimal, fx: Decimal) -> Decimal:
        fx = fx or Decimal("1")
        if fx == 0:
            fx = Decimal("1")
        return (Decimal(bs) / fx)

    # ----------------------------
    # Datos
    # ----------------------------
    dt = sale.created_at
    day = f"{dt.day:02d}"
    month = f"{dt.month:02d}"
    year = f"{dt.year:04d}"

    factura_no = f"{int(sale.id):06d}"
    control_no = f"{int(sale.id):08d}"

    # Empresa (placeholders si no hay modelo)
    empresa_nombre = sget(getattr(sale, "company", None), "name", "") or "THE MOTHERFUCKING CHIVERA"
    empresa_rif = sget(getattr(sale, "company", None), "rif", "030346426") or ""
    empresa_dir = sget(getattr(sale, "company", None), "address", "El junquitooooooo") or ""
    empresa_tel = sget(getattr(sale, "company", None), "phone", "04123604659") or ""

    # Cliente (prioriza customer_* del sale)
    cliente_nombre = sget(sale, "customer_name", "")
    cliente_dir = sget(sale, "customer_address", "")
    cliente_id = sget(sale, "customer_id_doc", "")
    cliente_tel = sget(sale, "customer_phone", "")

    # Pago
    pm = (sget(sale, "payment_method", "") or "").upper().strip()
    pref = sget(sale, "payment_reference", "").strip()

    # Tasa
    tasa = Decimal(getattr(sale, "fx_usd", 1) or 1)

    # Totales base/iva/total (congelados en Bs)
    base_bs = Decimal(getattr(sale, "subtotal_bs", 0) or 0)
    iva_bs = Decimal(getattr(sale, "vat_bs", 0) or 0)
    total_bs = Decimal(getattr(sale, "total", 0) or 0)

    # Moneda única: si es USD convertimos base/iva/total a USD por tasa
    if cur == "USD":
        base = to_usd(base_bs, tasa)
        iva = to_usd(iva_bs, tasa)
        total = Decimal(getattr(sale, "total_usd", 0) or 0)  # coherente con total_bs/fx
        col_unit_label = "P/U USD"
        col_total_label = "TOTAL USD"
        moneda_label = "USD"
    else:
        base = base_bs
        iva = iva_bs
        total = total_bs
        col_unit_label = "P/U Bs."
        col_total_label = "TOTAL Bs."
        moneda_label = "Bs"

    # ----------------------------
    # Layout base
    # ----------------------------
    margin_x = 15 * mm
    top_y = H - 15 * mm

    # Header empresa
    c.setFont("Helvetica-Bold", 16)
    c.drawString(margin_x, top_y, f"{empresa_nombre}")
    c.setFont("Helvetica", 11)
    c.drawString(margin_x, top_y - 10 * mm, f"RIF: {empresa_rif}")
    c.setFont("Helvetica", 9)
    c.drawString(margin_x, top_y - 18 * mm, f"{empresa_dir}   TELÉFONOS: {empresa_tel}")

    # Caja principal
    box_x = margin_x
    box_y = 35 * mm
    box_w = W - 2 * margin_x
    box_h = (top_y - 25 * mm) - box_y
    rect(box_x, box_y, box_w, box_h, lw=1.0)

    y = top_y - 30 * mm  # inicio interno

    # ----------------------------
    # Fila FACTURA / FECHA / CONTROL
    # ----------------------------
    row_h = 10 * mm
    rect(box_x, y - row_h, box_w, row_h)

    x_fact_w = 70 * mm
    x_mid_w = 60 * mm
    line(box_x + x_fact_w, y - row_h, box_x + x_fact_w, y)
    line(box_x + x_fact_w + x_mid_w, y - row_h, box_x + x_fact_w + x_mid_w, y)

    mid_x0 = box_x + x_fact_w
    third = x_mid_w / 3
    line(mid_x0 + third, y - row_h, mid_x0 + third, y)
    line(mid_x0 + 2 * third, y - row_h, mid_x0 + 2 * third, y)

    # FACTURA (izq)
    c.setFont("Helvetica", 9)
    c.drawString(box_x + 2 * mm, y - 7.2 * mm, f"FACTURA N° {factura_no}")

    # CONTROL (der)
    c.setFont("Helvetica", 9)
    c.drawString(box_x + x_fact_w + x_mid_w + 2 * mm, y - 7.2 * mm, f"N° CONTROL {control_no}")

    # FECHA (centro)
    c.setFont("Helvetica", 8)
    c.drawCentredString(mid_x0 + third / 2, y - 6.0 * mm, "DÍA")
    c.drawCentredString(mid_x0 + third + third / 2, y - 6.0 * mm, "MES")
    c.drawCentredString(mid_x0 + 2 * third + third / 2, y - 6.0 * mm, "AÑO")

    c.setFont("Helvetica", 10)
    c.drawCentredString(mid_x0 + third / 2, y - 9.0 * mm, day)
    c.drawCentredString(mid_x0 + third + third / 2, y - 9.0 * mm, month)
    c.drawCentredString(mid_x0 + 2 * third + third / 2, y - 9.0 * mm, year)

    y -= row_h

    # ----------------------------
    # Nombre o razón social
    # ----------------------------
    row_h = 10 * mm
    rect(box_x, y - row_h, box_w, row_h)
    c.setFont("Helvetica", 9)
    c.drawString(box_x + 2 * mm, y - 7 * mm, "NOMBRE O RAZÓN SOCIAL:")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(box_x + 55 * mm, y - 7 * mm, cliente_nombre)
    y -= row_h

    # ----------------------------
    # Domicilio fiscal
    # ----------------------------
    rect(box_x, y - row_h, box_w, row_h)
    c.setFont("Helvetica", 9)
    c.drawString(box_x + 2 * mm, y - 7 * mm, "DOMICILIO FISCAL:")
    c.setFont("Helvetica", 10)
    c.drawString(box_x + 40 * mm, y - 7 * mm, cliente_dir[:90])
    y -= row_h

    # ----------------------------
    # Cédula/RIF + Teléfono
    # ----------------------------
    rect(box_x, y - row_h, box_w, row_h)

    rif_w = 70 * mm
    line(box_x + rif_w, y - row_h, box_x + rif_w, y)

    c.setFont("Helvetica", 9)
    c.drawString(box_x + 2 * mm, y - 7 * mm, "N° CEDULA:")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(box_x + 25 * mm, y - 7 * mm, cliente_id)

    c.setFont("Helvetica", 9)
    c.drawString(box_x + rif_w + 2 * mm, y - 7 * mm, "TELÉFONO:")
    c.setFont("Helvetica", 10)
    c.drawString(box_x + rif_w + 25 * mm, y - 7 * mm, cliente_tel)
    y -= row_h

    # ----------------------------
    # Forma de pago (marcar opción + referencia)
    # ----------------------------
    row_h = 18 * mm
    rect(box_x, y - row_h, box_w, row_h)

    left_w = 28 * mm
    line(box_x + left_w, y - row_h, box_x + left_w, y)

    c.setFont("Helvetica", 9)
    c.drawString(box_x + 2 * mm, y - 7 * mm, "FORMA DE")
    c.drawString(box_x + 2 * mm, y - 12 * mm, "PAGO")

    x0 = box_x + left_w + 2 * mm
    c.setFont("Helvetica", 9)

    # Opciones marcadas
    is_pm = pm == "PAGO_MOVIL"
    is_punto = pm == "PUNTO"
    is_div = pm == "DIVISAS"
    is_usdt = pm == "USDT"

    c.drawString(x0, y - 6 * mm, f"[{check(is_pm)}] PAGO MÓVIL    [{check(is_punto)}] PUNTO")
    c.drawString(x0, y - 12 * mm, f"[{check(is_div)}] DIVISAS       [{check(is_usdt)}] USDT")

    # Referencia (solo si pago móvil)
    c.setFont("Helvetica", 9)
    if is_pm:
        c.drawRightString(box_x + box_w - 2 * mm, y - 12 * mm, f"REF: {pref}"[:40])

    c.setFont("Helvetica-Bold", 9)
    c.drawRightString(box_x + box_w - 2 * mm, y - 6 * mm, f"MONEDA: {moneda_label}")
    y -= row_h

    # -----------------------------
    # TABLA + FOOTER (sin solapes)
    # -----------------------------
    footer_h = 38 * mm
    footer_bottom = box_y
    footer_top = box_y + footer_h

    # Header tabla
    header_h = 10 * mm
    rect(box_x, y - header_h, box_w, header_h)

    col_cant = 18 * mm
    col_desc = 92 * mm
    col_alic = 25 * mm
    col_pu = 25 * mm

    x1 = box_x + col_cant
    x2 = x1 + col_desc
    x3 = x2 + col_alic
    x4 = x3 + col_pu

    for xx in (x1, x2, x3, x4):
        line(xx, y - header_h, xx, y)

    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(box_x + col_cant / 2, y - 7 * mm, "CANT.")
    c.drawCentredString(x1 + col_desc / 2, y - 7 * mm, "DESCRIPCIÓN")
    c.drawCentredString(x2 + col_alic / 2, y - 7 * mm, "% ALÍCUOTA")
    c.drawCentredString(x3 + col_pu / 2, y - 7 * mm, col_unit_label)
    c.drawCentredString(x4 + (box_x + box_w - x4) / 2, y - 7 * mm, col_total_label)

    y -= header_h

    # filas vacías (hasta footer_top)
    available_h = (y - footer_top)
    row_h = 10 * mm
    rows = max(1, int(available_h // row_h))

    for _ in range(rows):
        rect(box_x, y - row_h, box_w, row_h)
        for xx in (x1, x2, x3, x4):
            line(xx, y - row_h, xx, y)
        y -= row_h

    # Rellenar items
    start_y = y + rows * row_h
    write_y = start_y - 7 * mm
    i = 0

    c.setFont("Helvetica", 9)
    for it in sale.items.select_related("product"):
        if i >= rows:
            break

        qty = it.quantity

        if cur == "USD":
            unit = (it.unit_price_usd if it.unit_price_usd is not None
                    else (Decimal(it.unit_price) / (sale.fx_usd or Decimal("1"))))
            line_total = Decimal(unit) * Decimal(qty)
        else:
            unit = Decimal(it.unit_price)
            line_total = unit * Decimal(qty)

        c.drawCentredString(box_x + col_cant / 2, write_y, str(qty))
        c.drawString(x1 + 2 * mm, write_y, f"{it.product.name}"[:55])
        c.drawRightString(x4 - 2 * mm, write_y, money(unit))
        c.drawRightString(box_x + box_w - 2 * mm, write_y, money(line_total))

        write_y -= row_h
        i += 1

    # -----------------------------
    # FOOTER (zona reservada)
    # -----------------------------
    line(box_x, footer_top, box_x + box_w, footer_top, w=1.0)

    totals_x = box_x + 120 * mm
    totals_right = box_x + box_w
    line(totals_x, footer_bottom, totals_x, footer_top)

    # Nota izquierda
    c.setFont("Helvetica", 9)
    c.drawCentredString((box_x + totals_x) / 2, footer_bottom + 20 * mm,
                        "ESTA FACTURA VA SIN TACHADURA NI ENMIENDA")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(box_x + 55 * mm, footer_bottom + 12 * mm, "ORIGINAL")

    # Totales derecha
    r1 = 9 * mm
    r2 = 9 * mm
    r3 = 9 * mm
    yT = footer_top

    line(totals_x, yT - r1, totals_right, yT - r1)
    line(totals_x, yT - r1 - r2, totals_right, yT - r1 - r2)
    line(totals_x, yT - r1 - r2 - r3, totals_right, yT - r1 - r2 - r3)

    c.setFont("Helvetica", 9)
    c.drawString(totals_x + 4 * mm, yT - 6 * mm, "SUB-TOTAL")
    c.drawString(totals_x + 4 * mm, yT - r1 - 6 * mm, "AJUSTES")
    c.drawString(totals_x + 4 * mm, yT - r1 - r2 - 6 * mm, "IVA")
    c.drawString(totals_x + 4 * mm, yT - r1 - r2 - r3 - 6 * mm, "TOTAL A PAGAR")

    c.setFont("Helvetica-Bold", 10)
    # SUBTOTAL (base imponible)
    c.drawRightString(totals_right - 4 * mm, yT - 6 * mm, money(base))
    # AJUSTES (lo dejamos en blanco / 0)
    c.setFont("Helvetica", 10)
    c.drawRightString(totals_right - 4 * mm, yT - r1 - 6 * mm, money(Decimal("0.00")))
    # IVA
    c.setFont("Helvetica", 10)
    c.drawRightString(totals_right - 4 * mm, yT - r1 - r2 - 6 * mm, money(iva))
    # TOTAL
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(totals_right - 4 * mm, yT - r1 - r2 - r3 - 6 * mm, money(total))

    c.showPage()
    c.save()
    return buf.getvalue()
