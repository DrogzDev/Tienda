# authapi/views.py
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .auth import CookieJWTAuthentication
from .serializers import RegisterSerializer, LoginSerializer, MeSerializer

COOKIE_ACCESS  = "access"
COOKIE_REFRESH = "refresh"

def _set_token_cookies(response, access, refresh):
    # En dev: SameSite=Lax + Secure=False funciona si usas MISMO host
    response.set_cookie(COOKIE_ACCESS,  str(access),  httponly=True, secure=False, samesite="Lax", path="/")
    response.set_cookie(COOKIE_REFRESH, str(refresh), httponly=True, secure=False, samesite="Lax", path="/")
    return response

def _clear_token_cookies(response):
    response.delete_cookie(COOKIE_ACCESS,  path="/")
    response.delete_cookie(COOKIE_REFRESH, path="/")
    return response

@ensure_csrf_cookie
@api_view(["GET"])
@permission_classes([AllowAny])
def csrf_cookie(_request):
    # Coloca 'csrftoken' en el navegador
    return Response({"detail": "ok"})

@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    ser = LoginSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = ser.validated_data["user"]

    refresh = RefreshToken.for_user(user)
    access  = refresh.access_token

    resp = Response({"id": user.id, "username": user.username})
    return _set_token_cookies(resp, access, refresh)

@api_view(["POST"])
@permission_classes([AllowAny])
def refresh(request):
    token = request.COOKIES.get(COOKIE_REFRESH)
    if not token:
        return Response({"detail": "No refresh token"}, status=status.HTTP_401_UNAUTHORIZED)
    try:
        refresh_obj = RefreshToken(token)
        access = refresh_obj.access_token
    except Exception:
        return Response({"detail": "Invalid refresh"}, status=status.HTTP_401_UNAUTHORIZED)

    resp = Response({"detail": "refreshed"})
    return _set_token_cookies(resp, access, refresh_obj)

@api_view(["POST"])
def logout(_request):
    resp = Response({"detail": "logged out"})
    return _clear_token_cookies(resp)

@api_view(["GET"])
@authentication_classes([CookieJWTAuthentication])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(MeSerializer(request.user).data)

# ---- DEBUG opcional (solo en dev) ----
@api_view(["GET"])
@permission_classes([AllowAny])
def whoami(request):
    """
    Para depurar: ¿llega el cookie 'access'? ¿Qué ve DRF?
    Quita este endpoint en producción.
    """
    cookies = dict(request.COOKIES)
    return Response({
        "user": getattr(request.user, "username", None),
        "is_authenticated": bool(getattr(request.user, "is_authenticated", False)),
        "has_access_cookie": "access" in cookies,
        "has_refresh_cookie": "refresh" in cookies,
        "auth_header": request.META.get("HTTP_AUTHORIZATION"),
    })
