# inventory/utils.py
import io
import os
from django.conf import settings
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

def build_sale_invoice(sale) -> str:
    """
    Genera (o sobrescribe) el PDF de la venta y devuelve la ruta relativa (MEDIA_URL-based).
    media/invoices/sale_<id>.pdf
    """
    invoices_dir = os.path.join(settings.MEDIA_ROOT, "invoices")
    ensure_dir(invoices_dir)
    filename = f"sale_{sale.id}.pdf"
    abspath = os.path.join(invoices_dir, filename)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # Header
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20*mm, (H - 20*mm), "FACTURA / SALE")
    c.setFont("Helvetica", 10)
    c.drawString(20*mm, (H - 28*mm), f"N°: {sale.id}")
    c.drawString(20*mm, (H - 34*mm), f"Fecha: {sale.created_at:%Y-%m-%d %H:%M}")
    c.drawString(20*mm, (H - 40*mm), f"Almacén: {sale.store.name} [{sale.store.code}]")
    c.drawString(20*mm, (H - 46*mm), f"Vendedor: {sale.created_by.username}")

    # Table header
    y = H - 60*mm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(20*mm, y, "Producto")
    c.drawRightString(140*mm, y, "Cantidad")
    c.drawRightString(170*mm, y, "P. Unit.")
    c.drawRightString(190*mm, y, "Subtotal")
    c.line(20*mm, y-2, 190*mm, y-2)

    # Rows
    c.setFont("Helvetica", 10)
    y -= 8*mm
    for it in sale.items.select_related("product").all():
        c.drawString(20*mm, y, f"{it.product.name} ({it.product.sku})")
        c.drawRightString(140*mm, y, str(it.quantity))
        c.drawRightString(170*mm, y, f"{it.unit_price:.2f}")
        c.drawRightString(190*mm, y, f"{(it.quantity * it.unit_price):.2f}")
        y -= 7*mm
        if y < 30*mm:
            c.showPage()
            y = H - 20*mm

    # Total
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(170*mm, 25*mm, "TOTAL:")
    c.drawRightString(190*mm, 25*mm, f"{sale.total:.2f}")

    c.showPage()
    c.save()
    with open(abspath, "wb") as f:
        f.write(buf.getvalue())

    return f"{settings.MEDIA_URL}invoices/{filename}"
