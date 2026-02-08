from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
from django.db.models import Sum
from .models import Stock, Product, SaleItem

def _sync_product_active(product: Product):
    total = product.stocks.aggregate(s=Sum("quantity"))["s"] or 0
    new_active = total > 0
    if product.is_active != new_active:
        product.is_active = new_active
        product.save(update_fields=["is_active"])

@receiver([post_save, post_delete], sender=Stock)
def stock_changed(sender, instance: Stock, **kwargs):
    _sync_product_active(instance.product)

@receiver([post_save, post_delete], sender=SaleItem)
def saleitem_changed(sender, instance: SaleItem, **kwargs):
    _sync_product_active(instance.product)

# ---- Limpieza de archivos de imagen ----
@receiver(pre_save, sender=Product)
def delete_old_image_on_change(sender, instance: Product, **kwargs):
    if not instance.pk:
        return
    try:
        old = Product.objects.get(pk=instance.pk).image
    except Product.DoesNotExist:
        return
    new = instance.image
    if old and old != new:
        old.delete(save=False)

@receiver(post_delete, sender=Product)
def delete_image_file_on_delete(sender, instance: Product, **kwargs):
    if instance.image:
        instance.image.delete(save=False)
