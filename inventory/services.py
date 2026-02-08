from django.db import transaction
from django.core.exceptions import ValidationError
from decimal import Decimal
from django.utils import timezone
from .models import Product, Store, Stock, FxRate
from django.conf import settings

@transaction.atomic
def adjust_stock(*, product: Product, store: Store, delta: int):
    stock, _ = Stock.objects.select_for_update().get_or_create(
        product=product, store=store, defaults={"quantity": 0}
    )
    new_q = stock.quantity + int(delta)
    if new_q < 0:
        raise ValidationError(f"Stock insuficiente para {product.sku} en {store.code}")
    stock.quantity = new_q
    stock.save(update_fields=["quantity"])
    return stock

def get_current_fx() -> Decimal:
    """
    Devuelve la tasa Bs por USD desde settings.FX_USD_TO_BS.
    Si no está definida o no es válida, usa 1.00.
    """
    try:
        val = getattr(settings, "FX_USD_TO_BS", Decimal("1.00"))
        return Decimal(str(val))
    except Exception:
        return Decimal("1.00")

@transaction.atomic
def set_fx(usd_to_bs: Decimal, *, user) -> FxRate:
    return FxRate.objects.create(
        usd_to_bs=Decimal(usd_to_bs),
        effective_date=timezone.now().date(),
        created_by=user
    )
