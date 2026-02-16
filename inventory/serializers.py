from rest_framework import serializers

from django.db import transaction

from decimal import Decimal, ROUND_HALF_UP

from .models import Store, Category, Product, Stock, Sale, SaleItem, FxRate
def _requires_vat(payment_method: str) -> bool:

    return (payment_method or "").upper() in ("PAGO_MOVIL", "PUNTO")



# ------------------ STORE / CATEGORY ------------------



class StoreSerializer(serializers.ModelSerializer):

    class Meta:

        model = Store

        fields = "__all__"





class CategorySerializer(serializers.ModelSerializer):

    class Meta:

        model = Category

        fields = "__all__"





# ------------------ PRODUCT ------------------



class InitialStockItem(serializers.Serializer):

    store_id = serializers.PrimaryKeyRelatedField(queryset=Store.objects.all())

    quantity = serializers.IntegerField(min_value=0)

    min_threshold = serializers.IntegerField(min_value=0, required=False, default=0)





class ProductSerializer(serializers.ModelSerializer):

    categories = serializers.PrimaryKeyRelatedField(

        queryset=Category.objects.all(), many=True, required=False

    )



    image = serializers.ImageField(required=False, allow_null=True)

    image_url = serializers.SerializerMethodField(read_only=True)



    price_usd = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)



    total_stock = serializers.IntegerField(read_only=True)

    initial_stocks = InitialStockItem(many=True, write_only=True, required=False)

    stocks_detail = serializers.SerializerMethodField(read_only=True)



    class Meta:

        model = Product

        fields = (

            "id","sku","name","description","categories",

            "image","image_url",

            "price_usd",                

            "is_active","created_at",

            "total_stock","initial_stocks","stocks_detail"

        )

        read_only_fields = ("is_active","created_at","total_stock","stocks_detail","image_url")



    def validate_sku(self, value):

        qs = Product.objects.filter(sku=value)

        if self.instance:

            qs = qs.exclude(pk=self.instance.pk)

        if qs.exists():

            raise serializers.ValidationError("El SKU ya existe.")

        return value



    def validate_price_usd(self, value):

        v = Decimal(value or "0")

        if v < 0:

            raise serializers.ValidationError("El precio en USD no puede ser negativo.")

        return v.quantize(Decimal("0.01"))



    def get_image_url(self, obj):

        img = getattr(obj, "image", None)

        if not img:

            return None

        try:

            url = img.url

        except Exception:

            return None

        request = self.context.get("request")

        return request.build_absolute_uri(url) if request else url



    def get_stocks_detail(self, obj):

        return [

            {

                "store_id": s.store_id,

                "store_code": s.store.code,

                "quantity": s.quantity,

                "min_threshold": s.min_threshold,

                "updated_at": s.updated_at,

            }

            for s in obj.stocks.select_related("store").all()

        ]



    @transaction.atomic

    def create(self, validated_data):

        initial_stocks = validated_data.pop("initial_stocks", [])

        categories = validated_data.pop("categories", [])

        product = Product.objects.create(**validated_data)

        if categories:

            product.categories.set(categories)



        for item in initial_stocks:

            store = item["store_id"]

            qty = item["quantity"]

            thr = item.get("min_threshold", 0)

            st, _ = Stock.objects.get_or_create(

                product=product, store=store,

                defaults={"quantity": 0, "min_threshold": thr}

            )

            st.min_threshold = int(thr)

            st.quantity = int(qty)

            st.save(update_fields=["quantity", "min_threshold"])



        product.is_active = (product.total_stock > 0)

        product.save(update_fields=["is_active"])

        return product



    @transaction.atomic

    def update(self, instance, validated_data):

        initial_stocks = validated_data.pop("initial_stocks", None)

        categories = validated_data.pop("categories", None)



        for k, v in validated_data.items():

            setattr(instance, k, v)

        instance.save()



        if categories is not None:

            instance.categories.set(categories)



        if initial_stocks is not None:

            for item in initial_stocks:

                store = item["store_id"]

                qty = int(item["quantity"])

                thr = int(item.get("min_threshold", 0))

                st, _ = Stock.objects.get_or_create(

                    product=instance, store=store,

                    defaults={"quantity": 0, "min_threshold": thr}

                )

                st.quantity = qty

                st.min_threshold = thr

                st.save(update_fields=["quantity", "min_threshold"])



        instance.is_active = (instance.total_stock > 0)

        instance.save(update_fields=["is_active"])

        return instance





# ------------------ STOCK ------------------



class StockSerializer(serializers.ModelSerializer):

    store = StoreSerializer(read_only=True)

    store_id = serializers.PrimaryKeyRelatedField(

        queryset=Store.objects.all(), write_only=True, source="store"

    )



    class Meta:

        model = Stock

        fields = ("id","store","store_id","quantity","min_threshold","updated_at")





# ------------------ SALE ------------------



class SaleItemWriteSerializer(serializers.ModelSerializer):

    product_id = serializers.PrimaryKeyRelatedField(

        queryset=Product.objects.all(), source="product"

    )

    unit_price_usd = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)

    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)



    class Meta:

        model = SaleItem

        fields = ("product_id","quantity","unit_price_usd","unit_price")





class SaleItemLiteSerializer(serializers.ModelSerializer):

    product = serializers.SerializerMethodField()

    line_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)



    class Meta:

        model = SaleItem

        fields = ("id","product","quantity","unit_price_usd","unit_price","line_total")



    def get_product(self, obj):

        p = obj.product

        return {"id": p.id, "sku": p.sku, "name": p.name}





def _extract_pay_currency(notes: str | None) -> str | None:

    """

    Busca un tag 'PAYC=USD' o 'PAYC=VES' en notes.

    """

    if not notes:

        return None

    notes_up = str(notes).upper()

    if "PAYC=USD" in notes_up:

        return "USD"

    if "PAYC=VES" in notes_up or "PAYC=BS" in notes_up:

        return "VES"

    return None





class SaleSerializer(serializers.ModelSerializer):

    items = SaleItemWriteSerializer(many=True, write_only=True)

    items_detail = SaleItemLiteSerializer(many=True, read_only=True, source="items")

    created_by = serializers.PrimaryKeyRelatedField(read_only=True)



    # 👇 solo lectura para el front

    fx_usd = serializers.DecimalField(max_digits=12, decimal_places=4, read_only=True)

    total_usd = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    pay_currency = serializers.SerializerMethodField(read_only=True)  # USD o VES detectado en notes



    # 👇 write-only para registrar cómo pagó (se guardará como tag en notes)

    pay_currency_set = serializers.ChoiceField(

        choices=[("USD", "USD"), ("VES", "VES")],

        required=False,

        write_only=True

    )



    class Meta:

        model = Sale

        fields = (

            "id", "store", "created_by", "created_at",



            # ✅ datos factura

            "customer_name", "customer_address", "customer_id_doc", "customer_phone",



            # ✅ pago + referencia

            "payment_method", "payment_reference",



            # ✅ IVA + breakdown (solo lectura subtotal_bs/vat_bs)

            "vat_rate", "subtotal_bs", "vat_bs",



            # totales existentes

            "total", "total_usd", "fx_usd",



            # notas + tag moneda

            "notes", "pay_currency", "pay_currency_set",



            # items

            "items", "items_detail",

        )



        read_only_fields = (

            "created_at", "created_by",

            "fx_usd", "total", "total_usd",

            "subtotal_bs", "vat_bs",

            "pay_currency",

        )



    def get_pay_currency(self, obj):

        return _extract_pay_currency(getattr(obj, "notes", ""))



    def validate(self, attrs):

        """

        Reglas:

        - payment_method requerido

        - Si payment_method == PAGO_MOVIL: payment_reference requerido

        - Si payment_method cobra IVA (PAGO_MOVIL/PUNTO): exigir customer_name y customer_id_doc

        """

        pm = (attrs.get("payment_method") or "").upper().strip()

        ref = (attrs.get("payment_reference") or "").strip()



        if not pm:

            raise serializers.ValidationError({"payment_method": "La forma de pago es requerida."})



        if pm == "PAGO_MOVIL" and not ref:

            raise serializers.ValidationError({

                "payment_reference": "La referencia es obligatoria cuando la forma de pago es Pago móvil."

            })



        if _requires_vat(pm):

            if not (attrs.get("customer_name") or "").strip():

                raise serializers.ValidationError({"customer_name": "Requerido para facturar con IVA."})

            if not (attrs.get("customer_id_doc") or "").strip():

                raise serializers.ValidationError({"customer_id_doc": "Requerido para facturar con IVA."})



        return attrs



    @transaction.atomic

    def create(self, validated_data):

        from .services import adjust_stock, get_current_fx



        items = validated_data.pop("items", [])

        pay_currency_set = validated_data.pop("pay_currency_set", None)



        # crea venta con todo (incluye customer_*, payment_method, payment_reference, vat_rate, notes, store)

        sale = Sale.objects.create(**validated_data)



        fx = get_current_fx()  # Decimal: Bs por USD



        # Nota: aquí acumulamos el TOTAL cobrado en Bs (precio ya incluye IVA si aplica),

        # y total en USD equivalente según unit_price_usd (sin depender de fx final).

        total_bs = Decimal("0.00")

        total_usd_acc = Decimal("0.00")



        for it in items:

            product = it["product"]

            qty = int(it["quantity"])



            # 1) Resolver unit_price_usd prioritariamente

            if "unit_price_usd" in it and it["unit_price_usd"] is not None:

                up_usd = Decimal(str(it["unit_price_usd"]))

            elif "unit_price" in it and it["unit_price"] is not None:

                # viene en Bs → convertir a USD con la tasa vigente

                up_usd = Decimal(str(it["unit_price"])) / (fx or Decimal("1"))

            else:

                up_usd = Decimal(str(product.price_usd))



            up_usd = up_usd.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)



            # 2) Equivalente en Bs (fotografiado)

            up_bs = (up_usd * (fx or Decimal("1"))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)



            SaleItem.objects.create(

                sale=sale,

                product=product,

                quantity=qty,

                unit_price_usd=up_usd,

                unit_price=up_bs

            )



            total_usd_acc += (up_usd * Decimal(qty))

            total_bs += (up_bs * Decimal(qty))



            adjust_stock(product=product, store=sale.store, delta=-qty)

            product.is_active = (product.total_stock > 0)

            product.save(update_fields=["is_active"])



        total_bs = total_bs.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        total_usd_acc = total_usd_acc.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)



        # ===== IVA DESGLOSADO (IVA INCLUIDO EN EL PRECIO) =====

        # REGLA EXACTA PEDIDA:

        # base = total / 1.16

        # iva  = base * 0.16

        vat_bs = Decimal("0.00")

        base_bs = total_bs



        if _requires_vat(sale.payment_method):

            rate = Decimal(str(sale.vat_rate or Decimal("0.16"))).quantize(

                Decimal("0.0001"), rounding=ROUND_HALF_UP

            )

            divisor = (Decimal("1.00") + rate)  # 1.16



            # 1) Base imponible

            base_bs = (total_bs / divisor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)



            # 2) IVA = base * 0.16 (tal cual pediste)

            vat_bs = (base_bs * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)



            # (opcional pero recomendado) ajuste por redondeo para que base+iva == total

            # si NO quieres tocar esto, bórralo.

            diff = (total_bs - (base_bs + vat_bs)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

            if diff != Decimal("0.00"):

                vat_bs = (vat_bs + diff).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)



        # ===== Congelar valores =====

        sale.fx_usd = fx

        sale.subtotal_bs = base_bs     # BASE IMPONIBLE

        sale.vat_bs = vat_bs           # IVA (0 si no aplica)

        sale.total = total_bs          # TOTAL COBRADO



        # total_usd coherente con lo cobrado (usando total_bs / fx)

        if fx and fx != 0:

            sale.total_usd = (total_bs / fx).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        else:

            # fallback

            sale.total_usd = total_usd_acc



        # guarda moneda de pago en notes como tag, si viene

        if pay_currency_set in ("USD", "VES"):

            prefix = "PAYC=USD" if pay_currency_set == "USD" else "PAYC=VES"

            sale.notes = (sale.notes or "")

            if prefix not in sale.notes:

                sale.notes = (sale.notes + (" " if sale.notes else "") + f"[{prefix}]").strip()



        sale.save(update_fields=[

            "fx_usd",

            "subtotal_bs", "vat_bs",

            "total", "total_usd",

            "notes"

        ])

        return sale

    

# -------- FX Serializer para endpoints ----------

class FxRateSerializer(serializers.ModelSerializer):

    class Meta:

        model = FxRate

        fields = ("id","usd_to_bs","effective_date","created_at","created_by")

        read_only_fields = ("id","created_at","created_by")



    def validate_usd_to_bs(self, v):

        v = Decimal(v or "1")

        if v <= 0:

            raise serializers.ValidationError("La tasa debe ser mayor a 0.")

        return v.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

