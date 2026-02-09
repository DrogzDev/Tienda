from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.views import APIView
from django.db.models import Sum
from django.utils.timezone import now
from datetime import timedelta
from django.shortcuts import get_object_or_404
from django.http import HttpResponse
from django.conf import settings
import os
from decimal import Decimal
from rest_framework.permissions import DjangoModelPermissions
from .pdf import render_sale_pdf
from .models import Store, Category, Product, Stock, Sale
from .serializers import (
    StoreSerializer,
    CategorySerializer,
    ProductSerializer,
    StockSerializer,
    SaleSerializer,
    FxRateSerializer,
)
from .services import adjust_stock, set_fx, get_current_fx
from .filters import ProductFilter

# --------- CRUD básicos ---------

class StoreViewSet(viewsets.ModelViewSet):
    queryset = Store.objects.all().order_by("name")
    serializer_class = StoreSerializer
    permission_classes = [DjangoModelPermissions]


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all().order_by("name")
    serializer_class = CategorySerializer
    permission_classes = [DjangoModelPermissions]


class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.prefetch_related("categories", "stocks", "stocks__store").all()
    serializer_class = ProductSerializer
    permission_classes = [DjangoModelPermissions]
    filterset_class = ProductFilter
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["sku", "name", "description", "categories__name"]
    ordering_fields = ["name", "sku", "created_at", "is_active", "price_usd"]

    @action(detail=True, methods=["get"])
    def stocks(self, request, pk=None):
        product = self.get_object()
        data = StockSerializer(product.stocks.select_related("store"), many=True).data
        return Response(data)

    @action(detail=True, methods=["post"])
    def set_stock(self, request, pk=None):
        product = self.get_object()
        store_id = request.data.get("store_id")
        quantity = request.data.get("quantity")
        min_threshold = request.data.get("min_threshold", None)
        if store_id is None or quantity is None:
            return Response({"detail": "store_id y quantity son obligatorios."}, status=400)
        store = get_object_or_404(Store, pk=store_id)
        stock, _ = Stock.objects.get_or_create(product=product, store=store, defaults={"quantity": 0})
        stock.quantity = int(quantity)
        if min_threshold is not None:
            stock.min_threshold = int(min_threshold)
        stock.save()
        product.is_active = product.total_stock > 0
        product.save(update_fields=["is_active"])
        return Response(
            {
                "product_id": product.id,
                "store_id": store.id,
                "quantity": stock.quantity,
                "min_threshold": stock.min_threshold,
            }
        )

    @action(detail=True, methods=["post"])
    def adjust_stock(self, request, pk=None):
        product = self.get_object()
        store_id = request.data.get("store_id")
        delta = request.data.get("delta")
        if store_id is None or delta is None:
            return Response({"detail": "store_id y delta son obligatorios."}, status=400)
        store = get_object_or_404(Store, pk=store_id)
        try:
            st = adjust_stock(product=product, store=store, delta=int(delta))
        except Exception as e:
            return Response({"detail": str(e)}, status=400)
        product.is_active = product.total_stock > 0
        product.save(update_fields=["is_active"])
        return Response({"product_id": product.id, "store_id": store.id, "new_quantity": st.quantity})

    # ------- Imagen: subir / borrar -------
    @action(
        detail=True,
        methods=["post", "delete"],
        url_path="image",
        parser_classes=[MultiPartParser, FormParser],
        permission_classes=[DjangoModelPermissions],
    )
    def image(self, request, pk=None):
        product = self.get_object()

        if request.method == "DELETE":
            if product.image:
                product.image.delete(save=False)
                product.image = None
                product.save(update_fields=["image"])
            return Response(status=status.HTTP_204_NO_CONTENT)

        file = request.FILES.get("image")
        if not file:
            return Response({"detail": "Falta el campo 'image'."}, status=400)

        product.image = file
        product.save(update_fields=["image"])

        url = product.image.url
        if request:
            url = request.build_absolute_uri(url)
        return Response({"image_url": url})
    # --------------------------------------


# --------- SALES ---------

class SaleViewSet(viewsets.ModelViewSet):
    queryset = (
        Sale.objects
        .select_related("store", "created_by")
        .prefetch_related("items", "items__product")
    )
    serializer_class = SaleSerializer
    permission_classes = [DjangoModelPermissions]

    def perform_create(self, serializer):
        # created_by queda siempre ligado al user autenticado
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["get"], url_path="invoice")
    def invoice(self, request, pk=None):
        """
        GET /api/sales/{id}/invoice

        - Sin params: detecta moneda de pago (notes [PAYC=...]) o usa USD.
        - ?currency=USD|VES|BS  -> fuerza moneda de impresión.
        - ?download=1          -> fuerza descarga (attachment).
        - ?persist=1           -> guarda en /media/invoices y responde {"url": "...", "currency": "..."}.
        """
        sale = self.get_object()

        # -----------------------
        # Moneda de impresión
        # -----------------------
        param = (request.query_params.get("currency") or "").upper().strip()
        if param in ("USD",):
            currency = "USD"
        elif param in ("VES", "BS", "BSS"):
            currency = "VES"
        else:
            currency = _extract_pay_currency(sale.notes) or "USD"

        # Render PDF (usa sale.subtotal_bs / sale.vat_bs / sale.total ya congelados)
        pdf_bytes = render_sale_pdf(sale, currency=currency)

        # -----------------------
        # Persistir en media
        # -----------------------
        persist = (request.query_params.get("persist") or "").lower().strip() in ("1", "true", "yes")
        if persist:
            invoices_dir = os.path.join(settings.MEDIA_ROOT, "invoices")
            os.makedirs(invoices_dir, exist_ok=True)

            filename = f"sale_{sale.id}_{currency}.pdf"
            abspath = os.path.join(invoices_dir, filename)

            with open(abspath, "wb") as f:
                f.write(pdf_bytes)

            # construir URL pública usando MEDIA_URL
            # (evita os.path.join para URL si MEDIA_URL empieza con /)
            media_url = (settings.MEDIA_URL or "/media/").rstrip("/") + "/"
            url_path = f"{media_url}invoices/{filename}"
            url = request.build_absolute_uri(url_path)

            return Response({"url": url, "currency": currency})

        # -----------------------
        # Inline vs Download
        # -----------------------
        download = (request.query_params.get("download") or "").lower().strip() in ("1", "true", "yes")
        disp = "attachment" if download else "inline"

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'{disp}; filename="sale_{sale.id}_{currency}.pdf"'
        return response


# --------- FX (tasa Bs por USD) ---------
class FxView(APIView):
    permission_classes = [DjangoModelPermissions]  # o AllowAny
    def get(self, request):
        fx = get_current_fx().quantize(Decimal("0.01"))
        return Response({"usd_to_bs": str(fx)})

    def post(self, request):
        if not request.user.is_staff:
            return Response({"detail": "Solo admin puede actualizar la tasa."}, status=403)
        ser = FxRateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fx = set_fx(ser.validated_data["usd_to_bs"], user=request.user)
        return Response(FxRateSerializer(fx).data, status=201)

    def put(self, request):
        if not request.user.is_staff:
            return Response({"detail": "Solo admin puede actualizar la tasa."}, status=403)
        ser = FxRateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fx = set_fx(ser.validated_data["usd_to_bs"], user=request.user)
        return Response(FxRateSerializer(fx).data, status=201)

@api_view(["GET"])
@permission_classes([DjangoModelPermissions])  # o AllowAny si quieres que sea público
def stats(request):
    total_products = Product.objects.count()
    active_products = Product.objects.filter(is_active=True).count()
    inactive_products = total_products - active_products
    stock_global = Stock.objects.aggregate(total=Sum("quantity"))["total"] or 0
    stock_por_sede = list(
        Stock.objects.values("store__code").annotate(total=Sum("quantity")).order_by("store__code")
    )

    desde = now() - timedelta(days=30)
    ventas = Sale.objects.filter(created_at__gte=desde)
    ventas_total_bs = ventas.aggregate(s=Sum("total"))["s"] or Decimal("0.00")

    fx = get_current_fx()
    fx_ui = fx.quantize(Decimal("0.01"))  # 👈 2 decimales para UI

    return Response(
        {
            "products": {"total": total_products, "active": active_products, "inactive": inactive_products},
            "stock": {"global": stock_global, "por_sede": stock_por_sede},
            "sales_last_30d": {
                "count": ventas.count(),
                "total": float(Decimal(ventas_total_bs).quantize(Decimal("0.01"))),  # 👈 Bs con 2 decimales
            },
            "fx_usd": float(fx_ui),   # 👈 1 USD = fx_usd Bs (2 decimales)
            "fx_base": "USD",
            "fx_currency": "VES",
        }
    )
