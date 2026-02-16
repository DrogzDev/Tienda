# authapi/serializers.py
from django.contrib.auth import get_user_model, authenticate, get_user_model
from rest_framework import serializers

User = get_user_model()

class RegisterSerializer(serializers.ModelSerializer):
    """
    Registro mínimo: username, email opcional, password.
    """
    password = serializers.CharField(write_only=True, min_length=6, trim_whitespace=False)
    email = serializers.EmailField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["username", "email", "password"]

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )

class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = authenticate(username=attrs["username"], password=attrs["password"])
        if not user:
            raise serializers.ValidationError("Invalid credentials")
        if not user.is_active:
            raise serializers.ValidationError("Inactive user")
        attrs["user"] = user
        return attrs

class LogoutSerializer(serializers.Serializer):
    pass

class MeSerializer(serializers.ModelSerializer):
    """
    Devuelve datos básicos del usuario autenticado (sin profile).
    """
    groups = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "is_staff",
            "is_superuser",
            "last_login",
            "date_joined",
            "groups",
            "role",
        ]

    def get_groups(self, obj):
        return list(obj.groups.values_list("name", flat=True))

    def get_role(self, obj):
        return obj.groups.values_list("name", flat=True).first()
