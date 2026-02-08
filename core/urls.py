from django.contrib import admin
from django.urls import path, include
from django.conf.urls.static import static
from django.conf import settings

urlpatterns = [
    path("admin/", admin.site.urls),

    # Prefijos únicos aquí:
    path("api/auth/", include(("authapi.urls", "authapi"), namespace="authapi")),
    path("api/inventory/", include(("inventory.urls", "inventory"), namespace="inventory")),
]

# === Media ===
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)