# Python stdlib
import os
from datetime import datetime, timedelta
from decimal import Decimal

# Django
from django.conf import settings
from django.db.models import Count, Max, Sum
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

# DRF
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import DjangoModelPermissions, IsAdminUser, IsAuthenticated
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

# App
from .filters import ProductFilter
from .models import Category, Product, Sale, SaleItem, Stock, Store
from .pdf import render_sale_pdf
from .serializers import (
    CategorySerializer,
    FxRateSerializer,
    ProductSerializer,
    SaleSerializer,
    StockSerializer,
    StoreSerializer,
)
from .services import adjust_stock, get_current_fx, set_fx


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
    queryset = Product.objects.all()
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

        stock, _ = Stock.objects.get_or_create(
            product=product,
            store=store,
            defaults={"quantity": 0},
        )
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
        url = request.build_absolute_uri(url) if request else url
        return Response({"image_url": url})


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
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["get"], url_path="invoice")
    def invoice(self, request, pk=None):
        sale = self.get_object()

        param = (request.query_params.get("currency") or "").upper().strip()
        if param == "USD":
            currency = "USD"
        elif param in ("VES", "BS", "BSS"):
            currency = "VES"
        else:
            # OJO: _extract_pay_currency debe existir donde sea que lo tengas
            currency = _extract_pay_currency(sale.notes) or "USD"

        pdf_bytes = render_sale_pdf(sale, currency=currency)

        persist = (request.query_params.get("persist") or "").lower().strip() in ("1", "true", "yes")
        if persist:
            invoices_dir = os.path.join(settings.MEDIA_ROOT, "invoices")
            os.makedirs(invoices_dir, exist_ok=True)

            filename = f"sale_{sale.id}_{currency}.pdf"
            abspath = os.path.join(invoices_dir, filename)

            with open(abspath, "wb") as f:
                f.write(pdf_bytes)

            media_url = (settings.MEDIA_URL or "/media/").rstrip("/") + "/"
            url_path = f"{media_url}invoices/{filename}"
            url = request.build_absolute_uri(url_path)

            return Response({"url": url, "currency": currency})

        download = (request.query_params.get("download") or "").lower().strip() in ("1", "true", "yes")
        disp = "attachment" if download else "inline"

        response = HttpResponse(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'{disp}; filename="sale_{sale.id}_{currency}.pdf"'
        return response


# --------- FX (tasa Bs por USD) ---------

class FxView(APIView):
    def get_permissions(self):
        if self.request.method in ("POST", "PUT"):
            return [IsAdminUser()]
        return [IsAuthenticated()]

    def get(self, request):
        fx = get_current_fx().quantize(Decimal("0.01"))
        return Response({"usd_to_bs": str(fx)})

    def post(self, request):
        ser = FxRateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fx = set_fx(ser.validated_data["usd_to_bs"], user=request.user)
        return Response(FxRateSerializer(fx).data, status=201)

    def put(self, request):
        ser = FxRateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        fx = set_fx(ser.validated_data["usd_to_bs"], user=request.user)
        return Response(FxRateSerializer(fx).data, status=201)


# ------------------ KPI / STATS -------
class StatsView(APIView):
    permission_classes = [DjangoModelPermissions]
    queryset = Product.objects.all()  # ✅ obligatorio para DjangoModelPermissions

    def get(self, request):
        from django.db.models import Sum
        from django.db.models.functions import Coalesce
        from django.utils import timezone
        from datetime import timedelta
        from decimal import Decimal

        queryset = self.queryset

        total_products = queryset.count()
        active_products = queryset.filter(is_active=True).count()
        inactive_products = total_products - active_products

        stock_global = Stock.objects.aggregate(
            total=Coalesce(Sum("quantity"), 0)
        )["total"]

        stock_por_sede = list(
            Stock.objects.values("store__code")
            .annotate(total=Coalesce(Sum("quantity"), 0))
            .order_by("store__code")
        )

        desde = timezone.now() - timedelta(days=30)
        ventas = Sale.objects.filter(created_at__gte=desde)
        ventas_total_bs = ventas.aggregate(
            s=Coalesce(Sum("total"), Decimal("0.00"))
        )["s"]

        fx = get_current_fx().quantize(Decimal("0.01"))

        return Response(
            {
                "products": {
                    "total": total_products,
                    "active": active_products,
                    "inactive": inactive_products,
                },
                "stock": {
                    "global": int(stock_global or 0),
                    "por_sede": stock_por_sede,
                },
                "sales_last_30d": {
                    "count": ventas.count(),
                    "total": float(
                        Decimal(ventas_total_bs).quantize(Decimal("0.01"))
                    ),
                },
                "fx_usd": float(fx),
                "fx_base": "USD",
                "fx_currency": "VES",
            }
        )

class StockAlertsView(APIView):
    permission_classes = [DjangoModelPermissions]
    queryset = Product.objects.all()  # ✅ requerido por DjangoModelPermissions

    def get(self, request):
        fallback_threshold = int(request.query_params.get("threshold", 5))

        qs = (
            Product.objects
            .prefetch_related("stocks", "stocks__store")
            .order_by("name")
        )

        low_stock = []
        out_of_stock = []
        inactive = []

        for p in qs:
            total_stock = int(getattr(p, "total_stock", 0) or 0)

            thresholds = []
            for st in p.stocks.all():
                mt = int(getattr(st, "min_threshold", 0) or 0)
                if mt > 0:
                    thresholds.append(mt)

            effective_threshold = max(thresholds) if thresholds else fallback_threshold

            item = {
                "id": p.id,
                "name": p.name,
                "sku": p.sku,
                "total_stock": total_stock,
                "threshold": effective_threshold,
                "is_active": bool(p.is_active),
                "stocks_detail": [
                    {
                        "store_id": st.store_id,
                        "store_code": st.store.code if st.store_id else None,
                        "quantity": int(st.quantity),
                        "min_threshold": int(st.min_threshold or 0),
                        "updated_at": st.updated_at.isoformat() if getattr(st, "updated_at", None) else None,
                    }
                    for st in p.stocks.all()
                ],
            }

            if not p.is_active:
                inactive.append(item)
                continue

            if total_stock <= 0:
                out_of_stock.append(item)
            elif total_stock <= effective_threshold:
                low_stock.append(item)

        return Response({
            "threshold_fallback": fallback_threshold,
            "low_stock": low_stock,
            "out_of_stock": out_of_stock,
            "inactive_products": inactive,
        })


class TopSellingProductsView(APIView):
    permission_classes = [DjangoModelPermissions]

    # ✅ obligatorio para DjangoModelPermissions (elige un modelo “representativo”)
    queryset = SaleItem.objects.all()

    def _period_range(self, period: str, now=None):
        now = now or timezone.now()

        if period == "week":
            start = (now - timedelta(days=now.weekday())).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            end = start + timedelta(days=7)
            return start, end

        if period == "month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
            return start, end

        if period == "year":
            start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            end = start.replace(year=start.year + 1)
            return start, end

        raise ValueError("period must be one of: week, month, year")

    def _parse_dt(self, s: str):
        if not s:
            return None
        try:
            if len(s) == 10:
                dt = datetime.fromisoformat(s)
                return timezone.make_aware(dt)
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return timezone.make_aware(dt) if timezone.is_naive(dt) else dt
        except Exception:
            return None

    def get(self, request):
        period = (request.query_params.get("period") or "month").lower().strip()
        limit = int(request.query_params.get("limit", 10))

        start = self._parse_dt(request.query_params.get("start"))
        end = self._parse_dt(request.query_params.get("end"))

        if not (start and end):
            try:
                start, end = self._period_range(period)
            except ValueError:
                return Response({"detail": "period inválido. Usa: week, month, year"}, status=400)

        qs = (
            SaleItem.objects
            .filter(sale__created_at__gte=start, sale__created_at__lt=end)
            .values("product_id", "product__name", "product__sku")
            .annotate(
                total_units=Coalesce(Sum("quantity"), 0),
                total_sales_lines=Coalesce(Count("id"), 0),
            )
            .order_by("-total_units", "-total_sales_lines", "product__name")
        )

        rows = [
            {
                "product_id": r["product_id"],
                "name": r["product__name"],
                "sku": r.get("product__sku"),
                "total_units": int(r["total_units"] or 0),
                "total_sales_lines": int(r["total_sales_lines"] or 0),
            }
            for r in qs[:limit]
        ]

        return Response(
            {
                "range": {"start": start.isoformat(), "end": end.isoformat()},
                "period_used": "custom" if (request.query_params.get("start") and request.query_params.get("end")) else period,
                "best_seller": rows[0] if rows else None,
                "top_products": rows,
            }
        )