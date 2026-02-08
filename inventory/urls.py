from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import StoreViewSet, CategoryViewSet, ProductViewSet, SaleViewSet, stats, FxView

router = DefaultRouter()
router.register(r"stores", StoreViewSet)
router.register(r"categories", CategoryViewSet)
router.register(r"products", ProductViewSet)
router.register(r"sales", SaleViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("stats/", stats, name="inventory-stats"),
    path("fx/", FxView.as_view(), name="inventory-fx"),  # 👈 nuevo endpoint
]
