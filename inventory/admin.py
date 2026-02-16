from django.contrib import admin
from django.utils.html import format_html
from .models import Store, Category, Product, Stock, Sale, SaleItem


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "is_active")
    search_fields = ("name", "code")
    list_filter = ("is_active",)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug")
    search_fields = ("name", "slug")


class StockInline(admin.TabularInline):
    model = Stock
    extra = 0


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "sku", "is_active", "total_stock", "thumb")
    search_fields = ("name", "sku", "description")
    list_filter = ("is_active", "categories")
    inlines = [StockInline]
    filter_horizontal = ("categories",)

    def thumb(self, obj: Product):
        if obj.image:
            return format_html('<img src="{}" style="height:32px;width:auto;border-radius:6px" />', obj.image.url)
        return "-"
    thumb.short_description = "Imagen"


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("id", "store", "created_by", "created_at", "total")
    list_filter = ("store", "created_at")
    date_hierarchy = "created_at"
    inlines = [SaleItemInline]

@admin.register(SaleItem)
class SaleItemAdmin(admin.ModelAdmin):
    list_display = ("id", "sale_id", "sale_created_at", "product", "quantity", "unit_price", "line_total")
    list_select_related = ("sale", "product")
    search_fields = ("product__name", "product__sku", "sale__id")
    list_filter = ("sale__created_at", "sale__store")
    date_hierarchy = "sale__created_at"

    def sale_id(self, obj):
        return obj.sale_id
    sale_id.short_description = "Sale #"

    def sale_created_at(self, obj):
        return obj.sale.created_at
    sale_created_at.short_description = "Fecha"

    def line_total(self, obj):
        # ajusta si tu SaleItem usa otros campos (price, unit_price, etc.)
        try:
            return obj.quantity * obj.unit_price
        except Exception:
            return "-"
    line_total.short_description = "Total línea"