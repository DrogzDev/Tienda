# authapi/auth.py
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.exceptions import AuthenticationFailed

class CookieJWTAuthentication(JWTAuthentication):

    def authenticate(self, request):
        header = self.get_header(request)

        if header is not None:
            raw_token = self.get_raw_token(header)
        else:
            raw_token = request.COOKIES.get("access")

        if not raw_token:
            return None

        try:
            validated_token = self.get_validated_token(raw_token)
            user = self.get_user(validated_token)
            return user, validated_token

        except TokenError:
            # 👇 access expirado → intentar refresh
            refresh_token = request.COOKIES.get("refresh")
            if not refresh_token:
                raise AuthenticationFailed("Access token expired")

            try:
                refresh = RefreshToken(refresh_token)
                new_access = str(refresh.access_token)

                user = self.get_user(refresh)

                # guardamos el nuevo access para la response
                request._new_access_token = new_access

                return user, refresh.access_token

            except TokenError:
                raise AuthenticationFailed("Refresh token expired")
