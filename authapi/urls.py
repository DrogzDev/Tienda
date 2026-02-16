# authapi/urls.py
from django.urls import path
from . import views

app_name = "authapi"

urlpatterns = [
    path("csrf/",    views.csrf_cookie, name="csrf"),
    path("login/",   views.login,       name="login"),
    path("refresh/", views.refresh,     name="refresh"),
    path("logout/",  views.logout,      name="logout"),
    path("me/",      views.me,          name="me"),
    path("whoami/",  views.whoami,      name="whoami"),
]
