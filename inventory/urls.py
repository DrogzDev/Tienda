from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import StoreViewSet, CategoryViewSet, ProductViewSet, SaleViewSet, FxView, StatsView, TopSellingProductsView, StockAlertsView

router = DefaultRouter()
router.register(r"stores", StoreViewSet)
router.register(r"categories", CategoryViewSet)
router.register(r"products", ProductViewSet)
router.register(r"sales", SaleViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("fx/", FxView.as_view(), name="fx"),
    path("stats/", StatsView.as_view(), name="stats"),
    path("kpis/sales/top-products/", TopSellingProductsView.as_view(), name="kpis_sales_top_products"),
    path("kpis/stock/alerts/", StockAlertsView.as_view(), name="kpis_stock_alerts"),
]   
