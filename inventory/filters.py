import django_filters as df
from django.db import models
from .models import Product

class ProductFilter(df.FilterSet):
    q = df.CharFilter(method="search", label="Búsqueda")
    category = df.CharFilter(field_name="categories__slug", lookup_expr="iexact")
    is_active = df.BooleanFilter()
    min_stock = df.NumberFilter(method="with_min_stock")
    store = df.CharFilter(method="by_store", label="Sede (code)")

    class Meta:
        model = Product
        fields = ["q","category","is_active","min_stock","store"]

    def search(self, queryset, name, value):
        return queryset.filter(
            models.Q(name__icontains=value) |
            models.Q(sku__icontains=value) |
            models.Q(description__icontains=value)
        ).distinct()

    def with_min_stock(self, queryset, name, value):
        return queryset.filter(stocks__quantity__gte=value).distinct()

    def by_store(self, queryset, name, value):
        return queryset.filter(stocks__store__code=value).distinct()
