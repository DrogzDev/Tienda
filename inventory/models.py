from django.db import models
from django.utils import timezone
from django.contrib.auth import get_user_model
from decimal import Decimal
import os
import uuid

User = get_user_model()


def product_image_upload_to(instance: "Product", filename: str) -> str:
    """
    media/products/p<id|tmp>/<uuid>.<ext>
    """
    _, ext = os.path.splitext(filename or "")
    ext = (ext or ".jpg").lower()
    pid = instance.pk or "tmp"
    return f"products/p{pid}/{uuid.uuid4().hex}{ext}"


class Store(models.Model):
    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=50, unique=True)
    address = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name} ({self.code})"


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=80, unique=True)

    class Meta:
        verbose_name_plural = "Categories"

    def __str__(self):
        return self.name


class Product(models.Model):
    sku = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    categories = models.ManyToManyField(Category, blank=True, related_name="products")
    # 👇 PRECIO BASE EN USD (la UI lo edita; la venta lo “fotografía”)
    price_usd = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)  # se sincroniza con stock total
    image = models.ImageField(upload_to=product_image_upload_to, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["sku"]),
            models.Index(fields=["name"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self):
        return f"{self.name} [{self.sku}]"

    @property
    def total_stock(self) -> int:
        agg = self.stocks.aggregate(s=models.Sum("quantity"))
        return agg["s"] or 0


class Stock(models.Model):
    product = models.ForeignKey(Product, related_name="stocks", on_delete=models.CASCADE)
    store = models.ForeignKey(Store, related_name="stocks", on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField(default=0)
    min_threshold = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("product", "store")

    def __str__(self):
        return f"{self.product.sku} @ {self.store.code}: {self.quantity}"


# 👇 Historial de tasas: 1 USD = usd_to_bs (bolívares)
class FxRate(models.Model):
    usd_to_bs = models.DecimalField(max_digits=12, decimal_places=4)  # ej.: 40.2500 Bs por USD
    effective_date = models.DateField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="fxrates_created")

    class Meta:
        ordering = ["-effective_date", "-id"]

    def __str__(self):
        return f"{self.effective_date}: 1 USD = {self.usd_to_bs} Bs"


class Sale(models.Model):
    store = models.ForeignKey(Store, on_delete=models.PROTECT, related_name="sales")
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="sales_created")
    created_at = models.DateTimeField(default=timezone.now)

    # totales en MONEDA LOCAL (Bs) y en USD + tasa congelada
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))  # Bs (TOTAL FINAL)
    total_usd = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    fx_usd = models.DecimalField(max_digits=12, decimal_places=4, default=Decimal("1.0000"))  # 1 USD = fx_usd Bs
    notes = models.TextField(blank=True, default="")

    # ===================== NUEVO: DATOS DE FACTURACIÓN =====================
    customer_name = models.CharField("Nombre o Razón Social", max_length=180, blank=True, default="")
    customer_address = models.TextField("Domicilio", blank=True, default="")
    customer_id_doc = models.CharField("Número de cédula / RIF", max_length=40, blank=True, default="")
    customer_phone = models.CharField("Teléfono", max_length=40, blank=True, default="")

    # ===================== NUEVO: FORMAS DE PAGO =====================
    PAYMENT_METHODS = [
        ("PAGO_MOVIL", "Pago móvil"),
        ("PUNTO", "Punto"),
        ("DIVISAS", "Divisas"),
        ("USDT", "USDT"),
    ]
    payment_method = models.CharField(
        "Forma de pago",
        max_length=20,
        choices=PAYMENT_METHODS,
        blank=True,
        default="",
        db_index=True,
    )

    # ===================== NUEVO: REFERENCIA DE PAGO (PAGO MÓVIL) =====================
    payment_reference = models.CharField(
        "Referencia (Pago móvil / Punto)",
        max_length=60,
        blank=True,
        default="",
        db_index=True,
    )

    # ===================== NUEVO: IVA CONDICIONAL =====================
    # IVA SOLO si payment_method es PAGO_MOVIL o PUNTO
    vat_rate = models.DecimalField(max_digits=6, decimal_places=4, default=Decimal("0.16"))

    # breakdown congelado en Bs (recomendado para auditoría)
    subtotal_bs = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))  # sin IVA
    vat_bs = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))       # IVA Bs (0 si no aplica)

    class Meta:
        indexes = [
            models.Index(fields=["created_at"]),
            models.Index(fields=["store", "created_at"]),
            # útil para reportes y consultas rápidas
            models.Index(fields=["payment_method", "created_at"]),
            models.Index(fields=["payment_reference"]),
        ]
        ordering = ["-id"]

    def __str__(self):
        return f"Sale #{self.id} - {self.store.code} - {self.created_at:%Y-%m-%d}"


class SaleItem(models.Model):
    sale = models.ForeignKey(Sale, related_name="items", on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    # 👇 precio fotografiado en USD y su equivalente en Bs al momento de la venta
    unit_price_usd = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)  # Bs

    @property
    def line_total(self) -> Decimal:
        return (Decimal(self.quantity) * Decimal(self.unit_price)).quantize(Decimal("0.01"))
