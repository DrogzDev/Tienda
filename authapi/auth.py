# authapi/auth.py
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.exceptions import AuthenticationFailed

class CookieJWTAuthentication(JWTAuthentication):

    def authenticate(self, request):
        header = self.get_header(request)
        raw_token = self.get_raw_token(header) if header is not None else request.COOKIES.get("access")

        if not raw_token:
            return None

        try:
            validated_token = self.get_validated_token(raw_token)
            user = self.get_user(validated_token)
            return user, validated_token

        except TokenError:
            refresh_token = request.COOKIES.get("refresh")
            if not refresh_token:
                raise AuthenticationFailed("No refresh token")

            try:
                refresh = RefreshToken(refresh_token)
                new_access = str(refresh.access_token)

                # Validar el new_access como token real
                validated_access = self.get_validated_token(new_access)
                user = self.get_user(validated_access)

                request._new_access_token = new_access
                return user, validated_access

            except TokenError:
                raise AuthenticationFailed("Refresh token expired")
            except InvalidToken:
                raise AuthenticationFailed("Invalid refresh")
